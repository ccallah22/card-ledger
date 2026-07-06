# TheBinder Application Architecture

This document describes the major application areas in TheBinder and how they should evolve as the project moves from prototype structure to production architecture.

## Major Areas

### Marketing Pages

Public-facing pages such as home, about, pricing, privacy, terms, contact, help, changelog, status, and demo.

### Authenticated App

The logged-in application area containing account, cards, players, locations, wishlist, for-sale, sold, and backup features.

### Admin

Internal/admin-facing tools such as checklist management and image moderation.

### API Routes

Server-side routes for cards, checklists, image checks, image reports, support, and account deletion.

### Data Layer

The app should move toward a layered structure:

- Domain models describe business concepts.
- Repositories handle database access.
- Services handle business workflows.
- UI components display and collect data.

