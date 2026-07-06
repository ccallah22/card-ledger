insert into public.sports (name, slug)
values
  ('Baseball', 'baseball'),
  ('Basketball', 'basketball'),
  ('Football', 'football'),
  ('Hockey', 'hockey'),
  ('Soccer', 'soccer'),
  ('Golf', 'golf'),
  ('Tennis', 'tennis'),
  ('Racing', 'racing'),
  ('Wrestling', 'wrestling'),
  ('MMA', 'mma')
on conflict (slug) do nothing;

