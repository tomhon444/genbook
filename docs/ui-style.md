# Workspace UI style

The correspondence workspace follows the supplied exam-management screenshots as a visual reference. Correspondence content, navigation, permissions, and numbering workflows remain the source of product behavior.

## Shared styles

Defined in `app/globals.css`, imported after CoreUI in the root layout:

| Element | Style |
| --- | --- |
| Header and primary actions | Muted red `#b53639` |
| Main text | Navy `#172b42` |
| Secondary text | Slate `#64758a` |
| Page background | Neutral `#fafafa` |
| Panels | White, 8px corners, subtle border |
| Borders | Cool gray `#d6e0ea` |
| Table header and alternate rows | Light gray `#f4f7f9` |
| Small positive indicators | Green background and dark green text |
| Inputs and action buttons | 5–6px corners, minimum 40px height |

The red header contains the product identity, current user, and logout. Navigation stays below it with an underline on the current page. Mobile uses two header rows; filters change from three columns to two on tablets and one on mobile. Wide document tables scroll inside their own container.

The home page starts directly with the search panel. Its search title is the page's main heading; the redundant home title, description, and personal-workspace badge are omitted to leave more room for document results.

Keep factual statuses visible, including read-only historical records and successful issuance messages. Green indicators must describe existing product state; do not infer document status from its origin or type. Selected radio options use a red outline and pale red fill, with the native radio indicator retained.

Keyboard focus, loading and disabled states, semantic form labels, and reduced-motion support remain available. No database migration is required.

## Login

The login screen follows the supplied centered split-card reference: a 772px-wide white card on `#dfe6e9`, a white form on the left, and red product branding on the right. The supplied PSU engineering logo is served from `public/psu-engineer.webp` through Next.js Image. The submit button uses faculty navy `#063e70`.

At 640px and below, the form stacks above the branding panel and controls use a minimum 44px height. Input labels remain available to assistive technology while placeholders match the compact reference. The blue information notice describes the actual local-test environment; university-account integration, exam dates, and support contact details are not inferred from the visual reference. Authentication, session handling, and error dialogs are unchanged.
