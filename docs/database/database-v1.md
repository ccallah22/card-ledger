# TheBinder Database v1

This document defines the first production database design for TheBinder.

TheBinder separates the global card catalog from user-owned inventory.

A card record describes what the card is.

A user card record describes a specific copy, stack, graded card, or owned inventory item in a user's collection.

## Core Tables

### User Data

- profiles
- locations
- user_cards

### Card Catalog

- sports
- leagues
- teams
- players
- card_players
- sets
- cards
- card_variants

### Lookup Tables

- parallel_types
- grading_companies
- card_conditions
- sale_statuses

### Historical Data

- card_value_snapshots

## Key Design Decisions

### 1. Cards are separate from user-owned cards

The `cards` table stores the global card identity.

The `user_cards` table stores a user's owned copy, stack, or inventory item.

This allows multiple users to own the same card without duplicating catalog data.

### 2. Variants are separate from base cards

The `cards` table stores the base card.

The `card_variants` table stores manufactured versions such as Silver, Gold /10, Red Ice, Autograph, Memorabilia, or Short Print.

### 3. Players use a join table

Cards can have one or many players through `card_players`.

This supports single-player cards now while allowing dual autos, team cards, and multi-player inserts later.

### 4. Lookup tables are preferred over free text

Common values such as card conditions, sale statuses, grading companies, and parallel types are stored in lookup tables.

This keeps filtering, reporting, and search consistent.

## Entity Relationship Diagram (ERD)

```text
                           profiles
                               │
                 ┌─────────────┴─────────────┐
                 │                           │
           locations                  user_cards
                 │                           │
                 │                    ┌──────┼──────────────────────────┐
                 │                    │      │                          │
                 │                  cards  card_variants         grading_companies
                 │                    │          │
                 │                    │          │
                 │                    ├──────────┘
                 │                    │
                 │              card_players
                 │                    │
                 │                 players
                 │                    │
sports ───► leagues ───► teams        │
    │             │                   │
    │             └──────────┐        │
    │                        │        │
    └────────► sets──────────┴────────┘

Lookup Tables
-------------
parallel_types
card_conditions
sale_statuses

Historical
----------
card_value_snapshots
```