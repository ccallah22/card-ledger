# TheBinder Database Architecture

## Design Philosophy

The database is normalized to separate:

- Catalog data
- User inventory
- Lookup tables
- Reporting data

This minimizes duplication and allows millions of cards to share the same catalog records.

---

# Catalog

sports

leagues

teams

players

manufacturers

brands

sets

cards

card_players

parallel_types

card_variants

---

# User Data

profiles

user_cards

locations

device_sessions

---

# Lookup Tables

grading_companies

card_conditions

sale_statuses

---

# Supporting Data

value_snapshots

shared_images

image_reports

---

## Relationships

Sport
→ League
→ Team
→ Player

Sport
→ League
→ Set
→ Card
→ Card Variant

Card
↔ Players

User
→ User Cards

User Cards
→ Locations

User Cards
→ Card Variants

Card Variants
→ Parallel Types

---

## Principles

- Catalog data exists only once.
- Users never modify catalog records.
- User inventory references catalog records.
- Search operates against catalog tables.
- Collections operate against user tables.

