insert into public.teams (sport_id, name, nickname, abbreviation, slug)
select
  s.id,
  t.name,
  t.nickname,
  t.abbreviation,
  t.slug
from public.sports s
cross join (
  values
    ('Los Angeles Angels', 'Angels', 'LAA', 'los-angeles-angels'),
    ('New York Yankees', 'Yankees', 'NYY', 'new-york-yankees'),
    ('Los Angeles Dodgers', 'Dodgers', 'LAD', 'los-angeles-dodgers'),
    ('Boston Red Sox', 'Red Sox', 'BOS', 'boston-red-sox'),
    ('Chicago Cubs', 'Cubs', 'CHC', 'chicago-cubs')
) as t(name, nickname, abbreviation, slug)
where s.slug = 'baseball'
on conflict (sport_id, slug) do nothing;

