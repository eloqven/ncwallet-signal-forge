# Corridor Forge 30-Minute Signal Corridor Strategy

This document describes the current 30-minute coin forecast chart with the four interactive signal sliders:

```text
1. Bollinger influence
2. RSI influence
3. Momentum influence
4. Volatility regime
```

This is the chart opened through:

```text
Corridor Forge -> Open 30m signal chart
```

Direct local route:

```text
http://127.0.0.1:4185/report/30m
```

Source file:

```text
apps/corridor-forge/exports/coins-mentioned-30m-report-2026-05-19.html
```

The signal strategy is implemented inside the report itself as browser-side JavaScript. It does not call the server when a slider moves. The sliders reshape the already-created forecast corridor live in the browser.

## Core Idea

The chart has two layers:

```text
1. Actual price history
2. Forecast low/high corridor
```

The forecast starts from stored 30-minute forecast points:

```text
coin.forecast30m[]
```

Each point contains:

```text
label
short
low
high
mid
```

The white line is actual price:

```text
data.actualSnapshots[].prices[symbol]
```

The green line is forecast high.

The yellow line is forecast low.

The shaded area between green and yellow is the forecast interval.

The sliders do not replace the original forecast. They create an adjusted display forecast from the stored forecast plus the observed actual price behavior.

## Why This Exists

The 30-minute chart is a manual strategy laboratory.

Instead of generating one fixed forecast and accepting it blindly, this view lets us ask:

```text
How should the corridor change if I trust Bollinger behavior more?
How should it change if RSI is stretched?
How should it change if the latest trend is strong?
How should it change if volatility is calm or noisy?
```

The sliders let the user morph the interval and visually inspect whether the adjusted corridor better matches actual price behavior.

The goal is not to make the prettiest chart. The goal is to create a tunable corridor that remains narrow enough to be useful but flexible enough to adapt to different regimes.

## Data Used

The chart reads from embedded JSON:

```html
<script id="report-data" type="application/json">
```

Main fields:

```text
data.actualSnapshots
data.coins[]
coin.forecast30m[]
coin.priceUsdApprox
coin.qualityTier
coin.learning
```

Actual price series is built with:

```js
const actualSeriesForCoin = (symbol) =>
  (data.actualSnapshots || [])
    .map(snapshot => {
      const value = snapshot.prices && snapshot.prices[symbol];
      return value == null ? null : {
        label: snapshot.label || snapshot.date,
        value
      };
    })
    .filter(Boolean);
```

So the signals are based only on prices already stored in the report.

## Base Forecast

Before any slider is applied, every coin has a stored forecast:

```text
coin.forecast30m
```

Each point has a low, high, and mid.

The base forecast is treated as the default corridor. Every slider blends or reshapes that corridor.

Important:

```text
Slider value 0% = ignore that signal.
Slider value 100% = apply that signal fully.
```

The slider step is:

```text
2.5%
```

This gives more precise tuning than the earlier 5% step.

## Quality Tier Floor

The strategy uses a minimum band floor based on coin quality tier:

```js
const bollFloorByTier = {
  core: 0.0035,
  qualityAlt: 0.005,
  tactical: 0.0075,
  speculative: 0.011,
  weak: 0.014
};
```

Meaning:

- Core coins get tighter minimum bands.
- Quality alts get slightly more room.
- Tactical coins get more room again.
- Speculative coins get wide protection.
- Weak coins get the widest minimum protection.

Fallback:

```js
0.008
```

This floor is used mainly by the Bollinger-style corridor, but it also sets the tone for how tight the system is allowed to get.

## The Main Function

All four sliders are applied inside:

```js
adjustedForecast(
  coin,
  bollInfluence,
  rsiInfluence,
  momentumInfluence,
  volatilityInfluence
)
```

Input:

```text
coin
slider values from 0 to 100
```

Output:

```text
new adjusted forecast points
```

The output keeps the same shape as the base forecast:

```js
{
  ...point,
  low,
  high,
  mid
}
```

The chart draws only:

```text
actual line
adjusted low line
adjusted high line
filled interval
```

The center line is intentionally hidden so the visual focus stays on the corridor.

## Shared Pre-Calculations

For every coin, the strategy first builds the actual price list:

```js
const actual = actualSeriesForCoin(coin.symbol)
  .map(point => Number(point.value))
  .filter(Number.isFinite);
```

Then it uses the last 20 actual prices:

```js
const window = actual.slice(-20);
```

The basis price is:

```js
const basis = window.length
  ? mean(window)
  : Number(coin.priceUsdApprox || 0);
```

So if actual observations exist, the strategy uses recent observed behavior. If not, it falls back to the approximate coin price.

The local volatility estimate is:

```js
const sigma = Math.max(
  stdev(window),
  basis * (bollFloorByTier[coin.qualityTier] || .008)
);
```

This means the volatility estimate cannot collapse below the tier floor.

## Slider Normalization

Each slider value is converted from 0-100 into 0-1:

```js
const bollAmount = clamp(Number(bollInfluence || 0), 0, 100) / 100;
const rsiAmount = clamp(Number(rsiInfluence || 0), 0, 100) / 100;
const momentumAmount = clamp(Number(momentumInfluence || 0), 0, 100) / 100;
const volatilityAmount = clamp(Number(volatilityInfluence || 0), 0, 100) / 100;
```

The rest of the math uses those normalized values.

## Signal 1: Bollinger Influence

Purpose:

```text
Replace or blend the base corridor with a Bollinger-like volatility corridor.
```

This signal is not a textbook Bollinger Band drawn directly on price. It is a forecast corridor adjustment inspired by Bollinger behavior.

It uses:

- recent observed price standard deviation,
- coin quality floor,
- forecast horizon growth.

For each forecast point:

```js
const mid = Number(point.mid ?? ((point.low + point.high) / 2));
const stepGrow = 1 + Math.sqrt(index + 1) * .08;
const bollHalf = Math.max(
  mid * (bollFloorByTier[coin.qualityTier] || .008),
  sigma * (1.12 + Math.sqrt(index + 1) * .075)
);
```

Then it blends the original low/high into the Bollinger-shaped low/high:

```js
low = point.low * (1 - bollAmount)
  + (mid - bollHalf * stepGrow) * bollAmount;

high = point.high * (1 - bollAmount)
  + (mid + bollHalf * stepGrow) * bollAmount;
```

Interpretation:

- At 0%, use the original forecast low/high.
- At 100%, use the Bollinger-style corridor.
- Between 0% and 100%, interpolate between the two.

Why it helps:

- If the original forecast is too wide, Bollinger can tighten it.
- If the original forecast is too narrow during noisy periods, Bollinger can widen it.
- The tier floor stops the band from becoming unrealistically thin.

User label:

```text
Bollinger influence
wide heuristic -> tight Bollinger
```

Keyboard:

```text
1 toggles Bollinger on/off
B selects Bollinger for arrow-key adjustment
```

## Signal 2: RSI Influence

Purpose:

```text
Reshape the corridor based on whether price is stretched above or below neutral momentum.
```

RSI is calculated from recent actual price changes:

```js
const rsiForCoin = (coin) => {
  const actual = actualSeriesForCoin(coin.symbol)
    .map(point => Number(point.value))
    .filter(Number.isFinite);

  const changes = [];

  for (let i = Math.max(1, actual.length - 15); i < actual.length; i++) {
    changes.push(actual[i] - actual[i - 1]);
  }

  const gains = changes.map(v => Math.max(0, v));
  const losses = changes.map(v => Math.max(0, -v));
  const avgGain = mean(gains);
  const avgLoss = mean(losses);

  if (!avgLoss) return 100;
  if (!avgGain) return 0;

  return 100 - (100 / (1 + avgGain / avgLoss));
};
```

Then RSI is converted into pressure:

```js
const pressure = clamp((rsi - 50) / 50, -1, 1);
```

Meaning:

- RSI near 50 gives pressure near 0.
- RSI near 100 gives pressure near +1.
- RSI near 0 gives pressure near -1.

When RSI influence is active:

```js
const half = (high - low) / 2;
const center = (high + low) / 2;
const tilt = pressure * rsiAmount;
```

Then the lower and upper sides are resized differently:

```js
const lowFactor =
  1
  + rsiAmount * .18
  + Math.max(0, tilt) * .34
  - Math.max(0, -tilt) * .18;

const highFactor =
  1
  + rsiAmount * .18
  + Math.max(0, -tilt) * .34
  - Math.max(0, tilt) * .18;
```

Then:

```js
low = center - half * lowFactor;
high = center + half * highFactor;
```

Interpretation:

- If RSI is high, the lower side is given more room.
- If RSI is low, the upper side is given more room.
- This reflects the idea that stretched movement can mean reversal risk.

Why it helps:

- In overbought conditions, downside risk becomes more important.
- In oversold conditions, upside rebound risk becomes more important.
- The corridor becomes asymmetric instead of blindly centered.

User label:

```text
RSI influence
ignore RSI -> RSI-shaped band
```

Keyboard:

```text
2 toggles RSI on/off
R selects RSI for arrow-key adjustment
```

## Signal 3: Momentum Influence

Purpose:

```text
Shift and stretch the corridor in the direction of the recent trend.
```

Momentum uses the latest actual price window:

```js
const trendWindow = actual.slice(-16);
const trendBase = trendWindow.length > 1 ? trendWindow[0] : basis;
const trendLast = trendWindow.length ? trendWindow[trendWindow.length - 1] : basis;
const rawTrend = trendBase ? ((trendLast - trendBase) / trendBase) : 0;
```

The raw trend is normalized:

```js
const trendPressure = clamp(rawTrend / .035, -1, 1);
```

Meaning:

- A +3.5% recent move maps near +1.
- A -3.5% recent move maps near -1.
- Smaller trends map proportionally.

When Momentum influence is active:

```js
const half = (high - low) / 2;
const center = (high + low) / 2;
const horizon = Math.sqrt(index + 1) / Math.sqrt(Math.max(source.length, 1));
```

Then:

```js
const shift =
  center
  * trendPressure
  * momentumAmount
  * .018
  * horizon;

const stretch =
  1
  + Math.abs(trendPressure)
  * momentumAmount
  * .22
  * horizon;
```

And:

```js
low = center + shift - half * stretch;
high = center + shift + half * stretch;
mid = center + shift;
```

Interpretation:

- Strong upward trend shifts the corridor upward.
- Strong downward trend shifts it downward.
- Strong trend also stretches the corridor.
- The effect grows deeper into the forecast horizon.

Why it helps:

- Price often continues short-term drift for a while.
- A flat forecast corridor can be too stubborn during trend days.
- The horizon multiplier avoids overreacting at the first forecast point.

User label:

```text
Momentum influence
ignore drift -> trend-shaped band
```

Keyboard:

```text
3 toggles Momentum on/off
M selects Momentum for arrow-key adjustment
```

## Signal 4: Volatility Regime

Purpose:

```text
Tighten or widen the corridor based on whether the recent market is calm or noisy.
```

This signal uses recent percentage returns:

```js
const returns = [];

for (let i = Math.max(1, actual.length - 28); i < actual.length; i++) {
  if (actual[i - 1]) {
    returns.push((actual[i] - actual[i - 1]) / actual[i - 1]);
  }
}
```

Then it calculates a volatility pressure:

```js
const volPressure = clamp((stdev(returns) - .0035) / .010, -1, 1);
```

Interpretation:

- If recent return stdev is near 0.35%, pressure is near 0.
- If recent volatility is lower, pressure becomes negative.
- If recent volatility is higher, pressure becomes positive.

When Volatility influence is active:

```js
const half = (high - low) / 2;
const center = (high + low) / 2;
const horizon =
  .35
  + .65 * Math.sqrt(index + 1) / Math.sqrt(Math.max(source.length, 1));
```

The horizon starts at 0.35 and grows toward 1.0. So volatility influence exists early, but becomes stronger later.

Calm market tightening:

```js
const calmTighten = volPressure < 0
  ? volPressure * .28
  : 0;
```

Noisy market widening:

```js
const noisyWiden = volPressure > 0
  ? volPressure * .55
  : 0;
```

Final scale:

```js
const regimeScale =
  1
  + volatilityAmount
  * (calmTighten + noisyWiden)
  * horizon;
```

Then:

```js
low = center - half * regimeScale;
high = center + half * regimeScale;
mid = center;
```

Interpretation:

- Calm regime narrows the interval.
- Noisy regime widens the interval.
- Noisy widening is stronger than calm tightening.

Why noisy widening is stronger:

```text
Missing a volatility expansion is more dangerous than being slightly too wide in calm markets.
```

The exact weights:

```text
calm tightening factor = 0.28
noisy widening factor  = 0.55
```

User label:

```text
Volatility regime
ignore regime -> vol-shaped band
```

Keyboard:

```text
4 toggles Volatility on/off
V selects Volatility for arrow-key adjustment
```

## Signal Application Order

The signals are applied in this order:

```text
1. Base forecast
2. Bollinger influence
3. RSI influence
4. Momentum influence
5. Volatility regime
```

That order matters.

Bollinger first sets a volatility-style base corridor.

RSI then makes it asymmetric around the center.

Momentum then shifts and stretches the whole corridor.

Volatility regime then applies a final global width scale.

This makes practical sense:

- Bollinger asks: what should the band be from recent price spread?
- RSI asks: which side of the band deserves more room?
- Momentum asks: should the whole band drift?
- Volatility asks: should the whole band breathe wider or tighter?

## Keyboard Controls

The wide chart supports:

```text
B = select Bollinger slider
R = select RSI slider
M = select Momentum slider
V = select Volatility slider
```

Arrow keys:

```text
Left arrow  = decrease active signal
Right arrow = increase active signal
```

Numeric toggles:

```text
1 = toggle Bollinger on/off
2 = toggle RSI on/off
3 = toggle Momentum on/off
4 = toggle Volatility on/off
0 = toggle all signals on/off
```

Toggle behavior:

- If a signal is above 0, pressing its number saves the current value and sets it to 0.
- If a signal is 0, pressing its number restores the last saved value.
- If no saved value exists, it restores to 50.

This lets the user quickly compare:

```text
raw forecast vs one-signal forecast vs combined-signal forecast
```

## Wide View Control Dock

The wide chart has a compact control dock at the bottom.

It contains all four sliders in one row.

The dock is intentionally translucent and compact so it does not hide too much of the chart.

It appears on hover/focus and stays out of the way when not needed.

## How To Read The Chart

White line:

```text
actual observed price
```

Green line:

```text
adjusted forecast high
```

Yellow line:

```text
adjusted forecast low
```

Green/yellow shaded area:

```text
active adjusted interval
```

If the actual price stays inside the interval, the chosen signal mix is reasonable for that segment.

If actual price keeps touching the upper edge, the forecast may be too bearish or too narrow.

If actual price keeps touching the lower edge, the forecast may be too bullish or too narrow.

If the band is too wide to teach anything, reduce Bollinger/Volatility or disable signals.

If the band misses too often, increase Bollinger/Volatility or apply Momentum/RSI depending on the shape.

## Why These Four Signals Work Together

The four sliders cover different failure modes.

Bollinger solves:

```text
The base forecast width does not match recent observed spread.
```

RSI solves:

```text
The band is symmetric even though price is stretched.
```

Momentum solves:

```text
The center path is too flat while price is trending.
```

Volatility solves:

```text
The market regime changed from calm to noisy, or noisy to calm.
```

Together they let the user build a controlled corridor instead of relying on one blunt indicator.

## Why The Interval Can Stay Tight

The corridor stays tight when:

- recent volatility is low,
- coin quality tier allows a lower floor,
- Bollinger influence is high but sigma is low,
- Volatility regime sees a calm market,
- Momentum is not forcing extra stretch,
- RSI is near neutral.

The corridor widens when:

- recent actual prices are noisy,
- the coin has a speculative or weak tier,
- RSI is stretched,
- trend pressure is strong,
- volatility pressure is positive.

This is why the chart can look very precise on stable coins and wider on unstable coins.

## Important Difference From The 48h Generator

This 30-minute signal chart is not the same as the 48-hour forecast generator.

The 48-hour generator creates a new locked forecast from Binance candles.

The 30-minute signal chart reshapes an existing `forecast30m` corridor interactively.

So:

```text
48h app logic = generates a new forecast file.
30m signal chart = live-adjusts a stored forecast in the browser.
```

This document is about the second one.

## Current Exact Formula Summary

The whole adjustment can be summarized as:

```js
actual = observed prices for coin
window = last 20 actual points
basis = mean(window) or priceUsdApprox
sigma = max(stdev(window), basis * tierFloor)

bollAmount = sliderBoll / 100
rsiAmount = sliderRsi / 100
momentumAmount = sliderMomentum / 100
volatilityAmount = sliderVolatility / 100

for each forecast point:
  mid = point.mid or average(point.low, point.high)

  // Bollinger
  bollHalf = max(
    mid * tierFloor,
    sigma * (1.12 + sqrt(index + 1) * 0.075)
  )
  low = blend(point.low, mid - bollHalf * stepGrow, bollAmount)
  high = blend(point.high, mid + bollHalf * stepGrow, bollAmount)

  // RSI
  pressure = clamp((rsi - 50) / 50, -1, 1)
  tilt = pressure * rsiAmount
  resize low side and high side asymmetrically

  // Momentum
  trendPressure = clamp(rawTrend / 0.035, -1, 1)
  shift = center * trendPressure * momentumAmount * 0.018 * horizon
  stretch = 1 + abs(trendPressure) * momentumAmount * 0.22 * horizon
  shift and stretch the interval

  // Volatility
  volPressure = clamp((stdev(returns) - 0.0035) / 0.010, -1, 1)
  regimeScale = 1 + volatilityAmount * (calmTighten + noisyWiden) * horizon
  scale final interval width
```

## Notes For Another Agent

If another agent wants to extend this strategy, the clean path is:

1. Add a new signal storage object.
2. Add it to `signalOrder`.
3. Add a slider in `signalControls`.
4. Add a calculation block inside `adjustedForecast`.
5. Add a keyboard selector and numeric toggle.
6. Keep the signal optional by making 0% equal no effect.

The most important design rule:

```text
Every signal must be reversible and explainable.
```

The user should be able to turn it off and instantly see what changed.

## Current Weaknesses

Known limits:

- Slider values are not saved permanently per coin yet.
- The adjusted corridor is visual only unless exported later.
- The strategy uses only stored actual prices in the report.
- It does not pull fresh Binance data while dragging sliders.
- The base `forecast30m` generation logic is separate from the slider logic.
- Signal combinations can overfit visually if the user tunes after seeing actual data.

Those are acceptable for now because this chart is a research and calibration surface.

## Practical Best Use

Use the chart like this:

1. Start with all sliders at 0.
2. Increase Bollinger until the band fits recent actual spread.
3. Add Momentum only if the actual line is clearly trending.
4. Add RSI if the trend looks stretched or reversal-prone.
5. Add Volatility if the market is either too calm or too noisy for the current band.
6. Use number keys to compare each signal on/off.
7. Keep the tightest band that still respects actual behavior.

The best corridor is not the widest corridor.

The best corridor is the narrowest corridor that does not constantly lie.

## Next Phase: Manual Fit Labels To Learned Corridor Strategy

The next phase is to turn the wide-chart slider work into a supervised learning loop.

The important observation is that a visually good corridor is not just the corridor that contains every actual price. A huge corridor can contain everything and still be useless. The better target is:

```text
smallest useful interval area
+ enough actual-price containment
+ correct directional/trend behavior
+ no obvious fake confidence
```

This means the future model should not optimize only for “inside band percentage.” It must optimize a balance between tightness and truthful fit.

### Human-In-The-Loop Data

The user will manually inspect old forecasts and tune the sliders until the corridor looks like a good fit.

For each coin/report/window, the app should save:

```text
forecastId
symbol
density
pointCount
forecastStart
forecastEnd
base forecast low/high/mid
actual input window
observed actuals after forecast creation
slider values 1-8
user fit label
user notes
createdAt
```

Useful user labels:

```text
perfect-fit
good-fit
trend-fit
too-wide
too-tight
missed-direction
bad-fit
```

The most important label is not just whether the actual price stayed inside the corridor. The important label is whether the corridor was tight enough to be useful while still respecting the actual move.

### Fit Score

The first scoring algorithm should be explicit, not neural-network magic.

Suggested score:

```text
fitScore =
  containmentScore
  - widthPenalty
  - breachPenalty
  + trendScore
  + smoothnessScore
```

Where:

```text
containmentScore = percent of observed actual points inside low/high band
widthPenalty = average corridor width relative to price
breachPenalty = distance and duration outside the band
trendScore = whether corridor slope matches actual direction
smoothnessScore = whether the band avoids ugly overreaction
```

The “perfect” manual examples should become positive labels. Wide bands that technically contain everything should not score highest because `widthPenalty` must punish useless area.

### Search Algorithm For Slider Fits

Before training a neural net, the app can brute-force or guided-search slider combinations.

Simple first version:

```text
for each saved forecast with actual observations:
  for each candidate slider combo:
    render adjusted corridor mathematically
    compute containmentScore
    compute widthPenalty
    compute breachPenalty
    compute trendScore
    compute total fitScore
  keep top N slider combos
  let user mark which one is actually best
```

Candidate slider search can start coarse:

```text
0%, 25%, 50%, 75%, 100%
```

Then refine around good zones:

```text
best +/- 10%
best +/- 5%
```

This avoids randomly guessing through all possible slider states.

### Why Trend Fit Is Harder

Width and containment are mostly math.

Trend fit is harder because the “right” corridor may not wrap every price point tightly. Sometimes the most useful corridor is the one that captures direction and regime, even if some points touch or breach the edge.

Trend features to measure:

```text
actual start-to-end return
actual regression slope
forecast midpoint slope
upper/lower band slope
first-half vs second-half move
max adverse excursion
time spent near upper edge
time spent near lower edge
```

A good trend-fit corridor should:

```text
point in the same broad direction as actual price
avoid huge unnecessary area
avoid placing the actual move mostly outside the band
avoid fake precision when volatility expands
```

### Future Neural Net Shape

The neural net should not directly replace the whole forecast engine at first.

The safer first model is:

```text
input: forecast context + coin features + recent actual features
output: suggested slider values and/or corridor width multipliers
```

Inputs could include:

```text
coin symbol / class / risk bucket
density and point count
recent returns
recent volatility
RSI-like pressure
momentum pressure
prior forecast error metrics
base corridor width
base corridor slope
manual label history for similar situations
```

Outputs:

```text
bollinger influence
RSI influence
momentum influence
volatility influence
composite influence
support influence
breakout influence
heuristic-brain influence
optional width multiplier
optional slope/center correction
```

This keeps the model explainable because it still outputs controls the user already understands.

### Training Data Rule

Manual labels must be stored before they train anything.

Do not train on every slider state the user casually tries. Train only on states the user explicitly marks as useful, rejected, too wide, too tight, or trend-fit.

This avoids poisoning the model with random exploration.

### Immediate Build Targets

Next implementation targets:

```text
1. Save immutable forecast records.
2. Append observations separately in observations.jsonl.
3. Add a "Save Fit Label" control in the wide chart.
4. Save current slider values with the chosen label.
5. Add a fit-score calculator for old forecasts.
6. Add a "Find Best Fit" search that proposes slider sets.
7. Let the user accept/reject suggested fits.
8. Train the first model only from accepted/rejected labeled examples.
```

### What May Be Missing

The plan needs one more thing before serious ML:

```text
clear separation between data known at forecast time and data observed later
```

Without that, the model can cheat by learning from future prices that were not known when the forecast was created.

So the honest data split is:

```text
input window = known before forecast
forecast record = locked at creation
observations = appended later
manual fit label = human judgment after actuals exist
```

This is the project trajectory:

```text
manual visual fitting
-> scored fit search
-> labeled fit dataset
-> model suggests slider strategy
-> model-generated corridor strategy
```

The current signal sliders are good enough for proof of concept. They do not need to be perfect yet. The first goal is to create useful labeled examples and prove that the scoring/search loop can find corridor settings similar to the user's manual "best fit" examples.

### Slider 9: Fit Balance

Slider 9 is not another raw market signal. It is the bridge between manual judgment and the future model.

It should stay disabled until enough real actual points exist inside the forecast window. Once the forecast window has enough observations, it opens a modal where the user can label the current slider state.

The modal saves:

```text
forecast id / report name
coin symbol
coverage percent
all slider values
fit-balance value
fit label
human notes
created timestamp
```

The fit-balance value means:

```text
0%   = prefer the smallest possible area
50%  = balance tight area and trend containment
100% = prefer broad trend correctness
```

This lets the app collect training examples without pretending it already knows the user's judgment. Later, a search pass can replay old forecasts, try many slider combinations, score them, and compare the result against the saved human labels.
