// Platform Delivery content script.
// A tab may consume only the Delivery bound to its exact tab ID by the background
// Send Run module. Manually opened Platform tabs therefore never see stale content.

const sendRunClient = Lark.createSendRunClient(chrome.runtime);
const platform = Lark.Platforms.match(window.location.href);
let consuming = false;
const pastedRunIds = new Set();

consumeDelivery();

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') consumeDelivery();
});

async function consumeDelivery() {
  if (consuming || !platform) return;
  consuming = true;
  let claim = null;
  try {
    // A very fast content script can run before tabs.create() has returned and the
    // background has attached this tab ID to its Delivery. Retry that short race.
    claim = await waitForClaim(platform.id);
    if (!claim) return;

    if (!pastedRunIds.has(claim.runId)) {
      await Lark.Platforms.paste({
        url: window.location.href,
        document,
        window,
        content: claim.content,
      });
      pastedRunIds.add(claim.runId);
    }

    await sendRunClient.settle({
      claimToken: claim.claimToken,
      status: 'delivered',
    });
    console.log(`LARK: Delivery ${claim.runId} pasted successfully`);
  } catch (error) {
    console.error('LARK: Delivery failed:', error);
    if (claim?.claimToken) {
      if (pastedRunIds.has(claim.runId)) {
        // The editor already verified the content. Do not mark that paste failed or
        // paste it again; reclaim after the lease and retry only the acknowledgement.
        scheduleAfterLease(claim);
      } else {
        const retryable = isRetryable(error);
        const settled = await settleFailure(claim.claimToken, error, retryable);
        if (retryable) {
          if (settled) setTimeout(consumeDelivery, 500);
          else scheduleAfterLease(claim);
        }
      }
    }
  } finally {
    consuming = false;
  }
}

async function waitForClaim(platformId) {
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      const claim = await sendRunClient.claim(platformId);
      if (claim) return claim;
    } catch (error) {
      // The service worker may be starting. Retry within the same bounded window.
      if (attempt === 19) throw error;
    }
    await sleep(250);
  }
  return null;
}

async function settleFailure(claimToken, error, retryable) {
  try {
    await sendRunClient.settle({
      claimToken,
      status: retryable ? 'retryable-failure' : 'terminal-failure',
      error: { code: error.code || 'PLATFORM_DELIVERY_FAILED', message: error.message },
    });
    return true;
  } catch (settleError) {
    console.error('LARK: Could not settle failed Delivery:', settleError);
    return false;
  }
}

function isRetryable(error) {
  return [
    'PLATFORM_EDITOR_TIMEOUT',
    'PLATFORM_EDITOR_NOT_FOUND',
    'PLATFORM_EDITOR_VERIFY_FAILED',
  ].includes(error?.code);
}

function scheduleAfterLease(claim) {
  const delay = Math.max(250, Number(claim.leaseExpiresAt || 0) - Date.now() + 50);
  setTimeout(consumeDelivery, delay);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
