# Egydahab — Everything In One Place

This is your whole project — the website AND the automatic price updater — merged
into one upload. Do this once, and you're done forever.

## The only steps you need

### 1. Upload everything to your GitHub repo (dimarizo53-creator/egydahab.3)
Unzip this file. You'll get a folder with the website pages (index.html, about.html,
etc.) AND a hidden `.github` folder (the automation) AND a few `.js`/`.json` files
(the price-updating script) all together.

Go to your repo on github.com → click "Add file" → "Upload files" → drag in
**everything** from the unzipped folder at once (select all files in your file
explorer with Ctrl+A, then drag them all in together). Commit.

⚠️ The `.github` folder needs to land at the path `.github/workflows/update-prices.yml`.
If GitHub's drag-and-drop flattens folders for you, use "Add file → Create new file",
type the exact path `.github/workflows/update-prices.yml` in the filename box, and
paste that file's content in (open it in Notepad first to copy it).

### 2. Connect that repo to Vercel (if you haven't already)
This is the step that makes everything automatic going forward — no more manual
redeploys, ever, for either the site or the price updates.
- In Vercel: "Add New..." → "Project" → "Import Git Repository" → pick `egydahab.3`
- Vercel will deploy the site automatically, and will keep redeploying automatically
  every time anything in the repo changes (including when the price bot updates
  prices.json)

### That's it. From here on, nothing needs your attention:
- Every 15 minutes, GitHub runs the price-checking script by itself (for free)
- It writes fresh prices into `prices.json` in your repo
- Vercel notices the change and redeploys your live site automatically
- Your site's `index.html` is already pointed at the right URL — nothing to edit

## How to check it's actually working (optional, once)
In your repo, click the "Actions" tab. You should see "Update Gold & Currency
Prices" runs happening automatically every 15 minutes with green checkmarks.
Click into any run's logs to see real numbers like:
```
Gold/silver refreshed OK — 24K sell: 6742.75
Currencies refreshed OK — USD: {"sell":51.07,"buy":50.97} sources: {"USD":"isagha",...}
```

If a run ever shows a red X, click in, copy the error text from the logs, and send
it to me — that's the one thing that still needs a human (me) to interpret and fix.
