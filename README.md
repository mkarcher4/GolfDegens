# Golf Degens (GD$)

Weekly PGA Tour snake-draft league tracker: a live draft board, ESPN live scoring, the MMGW Index, the FRL side pot, the season money leaderboard and the schedule. It installs to an iPhone home screen as an app.

- **Front end:** plain HTML/CSS/JS with no build step.
- **Back end:** Vercel serverless functions in `api/`.
- **Data:** Upstash Redis, free tier, added through the Vercel Marketplace.
- **Scores:** ESPN's public golf scoreboard feed, cached about 30 seconds and saved permanently once a tournament is final.

---

## Deploy (about 10 minutes)

### 1. Put it on GitHub
```bash
cd golf-degens
git init && git add . && git commit -m "Golf Degens"
gh repo create golf-degens --private --source=. --push   # or create the repo on github.com and push
```

### 2. Import it into Vercel
1. Go to vercel.com and choose **Add New → Project**, then import the `golf-degens` repo.
2. Set **Framework Preset** to **Other**. Leave the Build Command and Output Directory empty.
3. Click **Deploy**.

### 3. Add the database (required)
1. In the Vercel project, open the **Storage** tab, choose **Create Database → Upstash → Redis (Free)** and connect it to this project.
2. Vercel adds the connection variables (`KV_REST_API_URL` / `KV_REST_API_TOKEN` or `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`). The app accepts either set.
3. Until this is done, the app shows a yellow **"Database not connected"** banner and nothing it saves will last.

### 4. Set the PINs
Under **Project → Settings → Environment Variables**, add:

| Name | Value | What it does |
|---|---|---|
| `ADMIN_PIN` | something only you know | Unlocks the **Commish** tab: draft orders, odds, undo picks, result overrides |
| `LEAGUE_PIN` | something you share with the Degens | Required to make a draft pick (optional; leave it unset for no PIN) |

Then **redeploy** (Deployments → ⋯ → Redeploy) so the new variables take effect.

### 5. Add it to everyone's iPhone
Open the Vercel URL in **Safari**, tap **Share → Add to Home Screen**, and the GD$ icon appears. On first open, each person taps their initials (CC, GW, JR, JS, MK, MM) and enters the league PIN.

---

## Weekly routine (commissioner)

1. **Draft orders:** upload them all at once on **Commish → Upload draft orders**, or set one week at a time under **Commish → Week**. JSON format:
   ```json
   {
     "The American Express": ["MK","CC","GW","JR","JS","MM"],
     "2": ["CC","GW","JR","JS","MM","MK"],
     "Masters Tournament": ["GW","JR","JS","MM","MK","CC"]
   }
   ```
   Keys can be week numbers (1–32) or tournament names. A list like `[{"week": 1, "order": [...]}]` also works.
2. **Odds (optional):** copy the outright winner odds from DraftKings and paste them into **Commish → DraftKings odds**. The draft list then sorts by odds. Golfers ESPN hasn't listed yet get added too.
3. **Draft:** everyone opens **This Week**. Whoever's on the clock taps **Draft**, then **Confirm**. Every phone updates within about 3 seconds. In commissioner mode you can pick for whoever is on the clock, undo the last pick, or lock the draft.
4. **Scoring is automatic.** The winner, FRL and DFL are read from ESPN. If something comes out wrong (a suspended round, a name mismatch), set it under **Commish → Results**.

## Rules as built

- **Rounds:** 6 rounds standard; 8 for the four majors and THE PLAYERS (Tier 1); 4 plus a DFL round for the TOUR Championship. You can override this per week.
- **Winner pot:** the tier stake per Degen ($30 / $20 / $15), and the winner collects it from the other 5. A playoff winner counts. If the winner was undrafted, no money moves.
- **FRL:** $5 per Degen for the **solo** first-round leader. If drafted golfers tie, the pot splits. If any tied leader is undrafted, nobody wins and the stake rises by $1 per Degen until someone wins, then resets to $5.
- **DFL (TOUR Championship):** $5 per Degen to whoever drafted the dead-last finisher. Ties split, an undrafted golfer means no payout, and a WD or DQ doesn't count as last.
- **MMGW Index:** bragging rights only. It counts the best 4 golfers in 6-round events (CUT if fewer than 4 make the cut), the best 5 in 8-round events, and all 4 at the TOUR Championship (no cut, DFL pick excluded).
- **Money tab:** *Winnings* is money collected from other Degens. *Net* also subtracts what you paid out; the six nets always sum to $0.
- **Stakes:** change the default per tier under **Commish → League settings**, or for a single week under **Commish → Week**. The money board and schedule recalculate right away.

## Local development
```bash
npm run dev                 # http://localhost:3000, real ESPN, data saved to .data/
MOCK_ESPN=r3 npm run dev    # fake tournament: pre | r1 | r2 | r3 | final
npm test                    # rules engine tests
```

## Files
```
index.html, css/app.css, js/app.js   the app
js/league.js                         all league rules (shared by app + API)
js/schedule-data.js                  bundled 2027 schedule (Commish can upload a new one)
api/state.js                         league data + picks
api/leaderboard.js                   ESPN proxy, cache, result capture
api/pick.js                          draft picks (turn-checked, race-safe)
api/admin.js                         commissioner actions
server/                              Redis client, ESPN fetcher, helpers
icons/                               GD$ logo + iPhone icons
```

## Notes
- **ESPN's feed is unofficial.** If a tournament doesn't load, open it on espn.com/golf/leaderboard, copy the `tournamentId` number from the URL into **Commish → Week → ESPN event ID**, and save.
- **Free-tier usage:** the app polls quickly only during a live draft, and leaderboards are cached at Vercel's edge, so a season fits comfortably inside the Upstash and Vercel free limits.
