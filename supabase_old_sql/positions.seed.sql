insert into public.positions (sport_id, name, abbreviation, slug)
select
    s.id,
    p.name,
    p.abbreviation,
    p.slug
from public.sports s
cross join (
    values
        ('Pitcher', 'P', 'pitcher'),
        ('Catcher', 'C', 'catcher'),
        ('First Base', '1B', 'first-base'),
        ('Second Base', '2B', 'second-base'),
        ('Third Base', '3B', 'third-base'),
        ('Shortstop', 'SS', 'shortstop'),
        ('Left Field', 'LF', 'left-field'),
        ('Center Field', 'CF', 'center-field'),
        ('Right Field', 'RF', 'right-field'),
        ('Designated Hitter', 'DH', 'designated-hitter')
) as p(name, abbreviation, slug)
where s.slug = 'baseball'
on conflict (sport_id, slug) do nothing;

