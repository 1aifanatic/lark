# LARK

LARK captures useful content from the page a person is viewing and relays it, with their instructions, to one or more supported AI chat destinations.

## Language

**Send Run**:
A single user-initiated attempt to prepare content and relay it to the selected Platforms.
_Avoid_: Send job, batch, query

**Delivery**:
The part of a Send Run intended for one Platform. A Delivery can succeed or fail independently of the other Deliveries in the same Send Run.
_Avoid_: Paste slot, pending content

**Page Intake**:
Canonical content captured from a page-related source before the user's instructions are applied. Page Intake may represent an article, transcript, selection, link, or URL fallback.
_Avoid_: Extraction result, page payload

**Prepared Content**:
Canonical content assembled outside Page Intake, such as a repository comparison, but ready to enter a Send Run.
_Avoid_: Raw prompt, arbitrary payload

**Platform**:
A supported AI chat destination to which LARK can deliver content, such as ChatGPT or Claude.
_Avoid_: Provider, target LLM

**Preferences**:
The person's durable choices for available and selected Platforms, instructions, Skills, and appearance.
_Avoid_: Settings blob, configuration
