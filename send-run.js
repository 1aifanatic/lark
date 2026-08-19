// Send Run domain module.
// Owns preparation, target normalization, tab fan-out, exact-tab Delivery claims,
// retries, expiry, and cleanup. UI state stays in calling modules.

(function initSendRun(root) {
  const Lark = root.Lark = root.Lark || {};

  function createSendRun({
    preferences,
    pageIntake,
    platforms,
    compose,
    tabs,
    runStore,
    clock = () => Date.now(),
    createId = defaultId,
    sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
    policy = {},
  }) {
    const lifecycle = {
      runTtlMs: policy.runTtlMs || 10 * 60 * 1000,
      claimLeaseMs: policy.claimLeaseMs || 30 * 1000,
      maxAttempts: policy.maxAttempts || 3,
    };
    let mutationQueue = Promise.resolve();

    for (const [name, dependency] of Object.entries({ preferences, pageIntake, platforms, tabs, runStore })) {
      if (!dependency) throw new Error(`Send Run requires ${name}`);
    }
    if (typeof compose !== 'function') throw new Error('Send Run requires prompt composition');

    async function prepare(intent, options = {}) {
      const snapshot = options.preferences || await preferences.read();
      const intake = await pageIntake.capture(intent, options.context || {});
      const active = new Set(snapshot.skills?.activeIds || []);
      const skills = (snapshot.skills?.items || []).filter(skill => active.has(skill.id));
      const content = compose({
        systemPrompt: snapshot.prompt?.system || '',
        skills,
        content: intake.body,
        contentLabel: intake.contentLabel,
        meta: intake.meta || [],
      });
      if (!content || typeof content !== 'string') {
        throw runError('SEND_EMPTY_CONTENT', 'The Send Run produced no content.');
      }
      return {
        content,
        intake,
        preferencesRevision: snapshot.revision,
      };
    }

    async function start(intent, options = {}) {
      const snapshot = await preferences.read();
      const targetIds = normalizeTargetIds(options.platformIds || snapshot.platforms?.selected || []);
      if (!targetIds.length) throw runError('SEND_NO_TARGETS', 'Select at least one Platform.');

      const enabled = new Set(snapshot.platforms?.enabled || []);
      const targets = targetIds.map(platformId => {
        const platform = platforms.get(platformId);
        if (!platform) throw runError('SEND_UNKNOWN_PLATFORM', `Unknown Platform: ${platformId}`);
        if (!enabled.has(platformId)) throw runError('SEND_DISABLED_PLATFORM', `${platform.name || platformId} is disabled.`);
        return platform;
      });
      const prepared = await prepare(intent, { preferences: snapshot, context: options.context });
      const now = clock();
      const run = {
        id: createId('run'),
        status: 'opening',
        content: prepared.content,
        intakeKind: prepared.intake.kind,
        displayLabel: prepared.intake.displayLabel,
        createdAt: now,
        expiresAt: now + lifecycle.runTtlMs,
        targets: targets.map(platform => ({
          platformId: platform.id,
          url: platform.url,
          tabId: null,
          status: 'opening',
          attempts: 0,
          claimToken: null,
          claimExpiresAt: null,
          error: null,
        })),
      };
      await runStore.save(run);

      let openedCount = 0;
      for (let index = 0; index < run.targets.length; index++) {
        const target = run.targets[index];
        if (index > 0) await sleep(250);
        try {
          const tab = await tabs.create({ url: target.url, active: openedCount === 0 });
          target.tabId = tab.id;
          target.status = 'pending';
          openedCount++;
        } catch (error) {
          target.status = 'failed';
          target.error = serializeError(error, 'SEND_TAB_OPEN_FAILED');
        }
        await runStore.save(run);
      }

      if (!openedCount) {
        await runStore.remove(run.id);
        throw runError('SEND_TAB_OPEN_FAILED', 'No Platform tab could be opened.');
      }
      run.status = openedCount === run.targets.length ? 'delivering' : 'partial';
      await runStore.save(run);
      return receiptFor(run);
    }

    function claim({ tabId, platformId }) {
      return mutate(async () => {
        if (tabId == null || !platformId) return null;
        const now = clock();
        await removeExpiredRuns(now);
        const runs = await runStore.list();

        for (const run of runs) {
          const target = run.targets.find(candidate =>
            candidate.tabId === tabId && candidate.platformId === platformId
          );
          if (!target || ['delivered', 'failed'].includes(target.status)) continue;
          if (target.status === 'claimed' && target.claimExpiresAt > now) return null;
          if (target.attempts >= lifecycle.maxAttempts) {
            target.status = 'failed';
            target.error = { code: 'SEND_ATTEMPTS_EXHAUSTED', message: 'Delivery retry limit reached.' };
            await saveOrFinish(run);
            return null;
          }

          target.status = 'claimed';
          target.attempts += 1;
          target.claimToken = createId('claim');
          target.claimExpiresAt = now + lifecycle.claimLeaseMs;
          await runStore.save(run);
          return {
            claimToken: target.claimToken,
            runId: run.id,
            platformId,
            tabId,
            content: run.content,
            leaseExpiresAt: target.claimExpiresAt,
          };
        }
        return null;
      });
    }

    function settle({ claimToken, status, error }) {
      return mutate(async () => {
        if (!claimToken || !['delivered', 'retryable-failure', 'terminal-failure'].includes(status)) {
          throw runError('SEND_SETTLE_INVALID', 'Delivery settlement is invalid.');
        }
        const runs = await runStore.list();
        for (const run of runs) {
          const target = run.targets.find(candidate => candidate.claimToken === claimToken);
          if (!target || target.status !== 'claimed') continue;

          if (status === 'delivered') {
            target.status = 'delivered';
            target.error = null;
          } else if (status === 'retryable-failure' && target.attempts < lifecycle.maxAttempts) {
            target.status = 'pending';
            target.error = serializeError(error, 'SEND_DELIVERY_RETRYABLE');
          } else {
            target.status = 'failed';
            target.error = serializeError(error, 'SEND_DELIVERY_FAILED');
          }
          target.claimToken = null;
          target.claimExpiresAt = null;

          const terminal = run.targets.every(candidate => ['delivered', 'failed'].includes(candidate.status));
          const runStatus = !terminal
            ? 'delivering'
            : run.targets.every(candidate => candidate.status === 'delivered')
              ? 'completed'
              : run.targets.every(candidate => candidate.status === 'failed')
                ? 'failed'
                : 'partial';
          run.status = runStatus;
          await saveOrFinish(run);
          return { runId: run.id, targetStatus: target.status, runStatus };
        }
        throw runError('SEND_CLAIM_STALE', 'The Delivery claim is no longer active.');
      });
    }

    async function removeExpiredRuns(now) {
      const runs = await runStore.list();
      for (const run of runs) {
        if (run.expiresAt <= now) await runStore.remove(run.id);
      }
    }

    async function saveOrFinish(run) {
      const terminal = run.targets.every(target => ['delivered', 'failed'].includes(target.status));
      if (terminal) await runStore.remove(run.id);
      else await runStore.save(run);
    }

    function mutate(operation) {
      const result = mutationQueue.then(operation);
      mutationQueue = result.catch(() => {});
      return result;
    }

    return Object.freeze({ prepare, start, claim, settle });

    function receiptFor(run) {
      return {
        runId: run.id,
        status: run.targets.some(target => target.status === 'failed') ? 'partial' : 'opened',
        intakeKind: run.intakeKind,
        displayLabel: run.displayLabel,
        deliveries: run.targets.map(target => ({
          platformId: target.platformId,
          tabId: target.tabId,
          status: target.status === 'failed' ? 'failed' : 'opened',
          ...(target.error ? { error: target.error } : {}),
        })),
      };
    }
  }

  function normalizeTargetIds(ids) {
    return Array.isArray(ids)
      ? [...new Set(ids.filter(id => typeof id === 'string' && id))]
      : [];
  }

  function createChromeRunStore(storageArea, prefix = 'sendRun:') {
    if (!storageArea || typeof storageArea.get !== 'function' || typeof storageArea.set !== 'function') {
      throw new Error('Send Run store requires a storage adapter');
    }
    return Object.freeze({
      async list() {
        const all = await storageArea.get(null);
        return Object.entries(all)
          .filter(([key]) => key.startsWith(prefix))
          .map(([, run]) => run);
      },
      async save(run) {
        await storageArea.set({ [`${prefix}${run.id}`]: run });
      },
      async remove(runId) {
        await storageArea.remove(`${prefix}${runId}`);
      },
    });
  }

  function createSendRunClient(runtime) {
    if (!runtime || typeof runtime.sendMessage !== 'function') {
      throw new Error('Send Run client requires the runtime adapter');
    }
    const request = async (action, payload = {}) => {
      const response = await runtime.sendMessage({ action, ...payload });
      if (!response || response.ok !== true) {
        const error = new Error(response?.error?.message || 'Send Run request failed.');
        error.code = response?.error?.code || 'SEND_REQUEST_FAILED';
        throw error;
      }
      return response.value;
    };
    return Object.freeze({
      prepare: (intent, options = {}) => request('sendRun.prepare', { intent, options }),
      start: (intent, options = {}) => request('sendRun.start', { intent, options }),
      claim: platformId => request('sendRun.claim', { platformId }),
      settle: settlement => request('sendRun.settle', { settlement }),
    });
  }

  function serializeError(error, fallbackCode) {
    return {
      code: error?.code || fallbackCode,
      message: error?.message || 'Send Run failed.',
    };
  }

  function runError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
  }

  function defaultId(prefix) {
    if (root.crypto && typeof root.crypto.randomUUID === 'function') {
      return `${prefix}-${root.crypto.randomUUID()}`;
    }
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }

  Lark.createSendRun = createSendRun;
  Lark.createChromeRunStore = createChromeRunStore;
  Lark.createSendRunClient = createSendRunClient;
})(globalThis);
