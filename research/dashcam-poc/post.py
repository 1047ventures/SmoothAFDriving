"""Clean up a lead2.py result: a lane change undone within 6 s was the paint
detector being fooled (a wall edge, a lost line), not us. Then relabel car-ahead
changes that line up with one of our real lane changes."""
import json, sys
r = json.load(open(sys.argv[1]))
ch = r['our_lane_changes']
drop = set()
for i, a in enumerate(ch):
    for j in range(i + 1, len(ch)):
        b = ch[j]
        if b['t'] - a['t'] < 6 and a['dir'] != b['dir'] and i not in drop and j not in drop:
            drop |= {i, j}
kept = [c for i, c in enumerate(ch) if i not in drop]
# Same direction within 6 s is one manoeuvre (often two lanes in one go).
merged = []
for c in kept:
    if merged and c['dir'] == merged[-1]['dir'] and c['t'] - merged[-1]['t_end'] < 6:
        merged[-1]['lanes'] += 1; merged[-1]['t_end'] = c['t']
    else:
        merged.append(dict(c, lanes=1, t_end=c['t']))
r['our_lane_changes'] = merged
r['dropped_as_false'] = [c for i, c in enumerate(ch) if i in drop]
for e in r['lead_changes']:
    e['type'] = 'we_changed_lanes' if any(-4 < c['t'] - e['t'] < 5 for c in r['our_lane_changes']) else 'cut_in'
json.dump(r, open(sys.argv[1].replace('.json', '_clean.json'), 'w'), indent=1)
print('ours:', [(c['t'], c['dir'], c['lanes']) for c in r['our_lane_changes']])
print('dropped:', [(c['t'], c['dir']) for c in r['dropped_as_false']])
print('ahead:', [(e['t'], e['type'], e['dist_m']) for e in r['lead_changes']])
