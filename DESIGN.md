# Design

<!-- impeccable:design-schema 1 -->

## Visual World

The admin demo uses an operations-console language: compact controls, clear status chips, crisp tables, and an inspector panel. It should feel like a practical site-owner tool attached to Twikoo, not a marketing landing page.

## Palette

Use a light work surface with graphite text, paper panels, and restrained status colors: teal for active/success, amber for caution/demo mode, rose for destructive or blocked states, and blue for primary actions. Avoid a single-hue interface.

## Typography

Use the system UI stack for fast-loading admin work. Headings are firm and compact; body text stays readable at 14-16px with no negative tracking.

## Layout

Desktop layout is a three-zone console: command/sidebar area, central user roster, and right-side profile inspector. Mobile collapses to one column with the roster first and forms below.

## Components

Inputs, buttons, status chips, avatars, tables, empty states, and toast messages must include hover, focus, loading, and error states. Panels use subtle shadow or border, not both as heavy decoration.

## Motion

Use small state transitions for toast messages, row selection, and panel focus only. Motion should reinforce admin state changes rather than decorate the surface.

## Accessibility

Controls require visible focus rings, labels, descriptive button text, adequate contrast, and non-color text for status where possible.
