# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

The primary user is a sculptor at an iPad: someone posing and sculpting with an Apple Pencil in the installed home-screen app, mostly to study and practise form. When audiences pull apart, design decisions favour this person.

Other audiences, in second place:

- The owner, who also sculpts, renders stills and reels, and publishes work to the gallery.
- Members with an account, who save projects and share work in the Community.
- Viewers of published work.
- Moderators, who review what members share.

## Product Purpose

A *bozzetto* is the small clay study a sculptor makes before the real piece. Bozzetto Web is a studio in the browser to pose a mannequin, sculpt in clay, and light and present the result. It was built as a study and teaching tool and as a way to render out content, and is shared under MIT.

Success is a sculptor getting from a blank scene to a presented piece without leaving the app, on an iPad, with a Pencil.

## Positioning

The whole path in a browser: Armature › Sculpt › Present in one free web app that installs to an iPad's home screen and works offline, with no app store and no account needed to sculpt.

Timelapses played back as real geometry (orbit, relight, scrub) exist in the product but are not offered to users right now, and will not be until the core of the app has been rebuilt. Do not lead with them or present them as a current user feature.

## Operating Context

- Used mainly as an installed home-screen app on iPad, fullscreen, with Apple Pencil; also on iPhone and on desktop with mouse and keyboard.
- Three workspaces in a fixed order, shown as a path: Armature (pose a mannequin), Sculpt, Present (lighting, render settings, output, publishing).
- Around the workspaces sit pages: the gallery, Community, My projects, Account, Review, and the owner's tools.
- The public viewer shows a published model or timelapse.
- The desktop counterpart, Bozzetto Studio, is a separate product.

## Capabilities and Constraints

- TypeScript with hand-built DOM, no UI framework; three.js on WebGPU; a vendored sculpting core; hosted on Cloudflare Pages with Functions.
- Works offline once installed; sculpts autosave to browser storage; sculpting needs no sign-in.
- Accounts use passkeys and emailed codes; joining is by invite.
- Publishing happens only from Present. Present is also where the owner edits a published project's lighting and settings.
- Timelapse recording, upload and reel rendering are owner-only for now.
- At most one side panel is open per side; under 1100px wide, one panel in all.
- Terms in the interface: Armature, Sculpt, Present, Gallery, Community, My projects, Review, Publish, Frames.
- Undecided: when timelapses return for users, and in what form, after the core rebuild.

## Brand Commitments

- Name: Bozzetto, with its handwritten logotype.
- The Gestalt v2 app layer is the existing visual system and is binding: dark only; a grey scale; square corners; orange for the active tool, a field's amount, the one main action on a screen, and focus; red for errors and deletes; one solid icon style; Familjen Grotesk for labels and Martian Mono for values.
- Pencil and touch first: everything must work with Apple Pencil and fingers on iPad and iPhone. Mouse works equally; the keyboard adds shortcuts and is never required.
- Tab has one job in the workspaces: it hides and shows the interface. It does not move focus there.
- Plain wording: interface text is short, plain sentences that say what happened and what to do. No marketing voice inside the app.

## Evidence on Hand

- The live app and its README, which describes every mode and feature.
- The design system and approved mockup boards kept as design artifacts, and the decisions log in `docs/HANDOFF.md`.
- UI notes in `docs/ui-foundations.md` and `docs/ui-spec.md`.
- There are no testimonials, user counts, press or benchmarks. Future work must not invent any.

## Product Principles

1. The sculptor's hand comes first: the viewport and the Pencil stroke outrank every panel and menu.
2. One path, three workspaces: Armature, then Sculpt, then Present. Each thing lives in one place on that path.
3. One main action per screen, and the interface stays quiet around it.
4. Say it plainly: every label, error and notice tells the person what happened and what to do.
5. Offer only what works today; features being rebuilt stay out of what users are promised.

## Accessibility & Inclusion

- Every control must be reachable by touch and Pencil without a keyboard.
- The Sculpt and Armature workspaces are pointer tools. They are not meant to be operated by keyboard alone, and no keyboard-only path through them is planned. Do not report the missing Tab order there as a defect or design one in.
- Pages outside the workspaces (gallery, Community, My projects, Account, Review, owner's tools, sign-in) and windows with form fields keep ordinary keyboard focus order.
- No formal standard has been set.
