begin;
delete from public.sets;
insert into public.sets (year, name, brand, sport, checklist_key) values
  ('2025', 'Panini Score', 'Panini', 'Football', 'score-2025'),
  ('2025', 'Panini Donruss', 'Panini', 'Football', 'donruss-2025'),
  ('2025', 'Panini Prizm', 'Panini', 'Football', 'prizm-2025'),
  ('2025', 'Panini Absolute', 'Panini', 'Football', null),
  ('2025', 'Topps Chrome', 'Topps', 'Baseball', null),
  ('2025', 'Bowman', 'Topps', 'Baseball', null),
  ('2025', 'Bowman Chrome', 'Topps', 'Baseball', null),
  ('2025', 'Panini Prizm Baseball', 'Panini', 'Baseball', null),
  ('2025', 'Panini Prizm Premium Baseball', 'Panini', 'Baseball', null),
  ('2025-26', 'Topps Chrome', 'Topps', 'Basketball', null),
  ('2025', 'Topps Chrome MLS', 'Topps', 'Soccer', null),
  ('2025', 'Topps UEFA Club Competitions', 'Topps', 'Soccer', null),
  ('2025', 'Panini Prizm FIFA Club World Cup', 'Panini', 'Soccer', 'prizm-cwc-2025'),
  ('2025-26', 'Upper Deck Allure', 'Upper Deck', 'Hockey', null),
  ('2025-26', 'Upper Deck Seasonal Releases', 'Upper Deck', 'Hockey', null);
commit;
