
import type { LifeTable } from './lev_data_loader';

// ------------------------------------------------------------------
// 0. Constants & Config
// ------------------------------------------------------------------
export const MAX_AGE_INTERNAL = 200;
export const HEALTH_MIDPOINT_BIOAGE = 72;
export const HEALTH_STEEPNESS = 9;
export const HEALTHSPAN_THRESHOLD = 0.70;
export const PROGRESS_RATE_BASE = 0.018; // 1.8% per year
export const PROGRESS_SIGMA0 = 0.030;
export const UPTAKE_SIGMOID_WIDTH = 0.12;
export const FRAILTY_A = 0.65;
export const LEV_K = Math.log(4) / 5; // ~0.277
export const LEV_MEDIAN_95 = 2040;
export const LEV_LAG_50_VS_95 = 10;
export const OPTIMISM_YEAR_SHIFT_PER_STEP = 3;
export const REJUV_TAU = 6;
export const REJUV_EXTRA = 0.20;

// Quantile Z-scores
const Z_SCORES: Record<number, number> = {
    5: -1.644853626,
    25: -0.674489750,
    50: 0,
    75: 0.674489750,
    95: 1.644853626
};

export function getZScoreForCentile(c: number): number {
    return Z_SCORES[c] ?? 0;
}

// Optimism is now -10..+5 (integer steps of 10%)
// k = PROGRESS_RATE_BASE * (1 + optimism * 0.1)

// ------------------------------------------------------------------
// 1. Utilities
// ------------------------------------------------------------------
export function sigmoid(x: number): number {
    return 1 / (1 + Math.exp(-x));
}

// Convert qx <-> hazard
export function qToH(q: number): number {
    if (q >= 1) return 100; // sufficiently large
    return -Math.log(1 - q);
}

export function hToQ(h: number): number {
    return 1 - Math.exp(-h);
}

// ------------------------------------------------------------------
// 2. Core Model Functions
// ------------------------------------------------------------------

// 3. Longevity score to frailty hazard multiplier z(score)
export function getFrailtyMultiplier(score: number): number {
    // score 1..99
    const p = score / 100;
    // zScore(p) = exp(FRAILTY_A * (0.5 - p))
    // Higher score -> p > 0.5 -> exponent negative -> multiplier < 1 (good)
    return Math.exp(FRAILTY_A * (0.5 - p));
}

// 4. Uptake factor u(p)
export function getUptakeFactor(p: number): number {
    return 0.6 + 0.8 * sigmoid((p - 0.5) / UPTAKE_SIGMOID_WIDTH);
}

// 5. Medical progress hazard multiplier r(y, p, qtile, optimism, horizonYear)
export function getProgressMultiplier(
    year: number,
    score: number, // integer 1..99
    quantileKey: number, // 5, 25, 50, 75, 95
    optimism: number, // -10..+5
    horizonYear: number,
    currentYear: number
): number {
    const p = score / 100;
    const yH = horizonYear;
    const elapsedYears = Math.max(0, Math.min(year, yH) - currentYear);

    if (elapsedYears <= 0) return 1.0;

    // Adjust progress speed with optimism (10% steps)
    // -10 => 1 + (-1.0) = 0 (No progress)
    // +5 => 1 + 0.5 = 1.5 (50% faster)
    if (optimism <= -10) return 1.0; // Hardlock for no progress

    const optimismFactor = optimism * 0.1;
    const k = PROGRESS_RATE_BASE * (1 + optimismFactor);

    // Mean log multiplier
    const u_p = getUptakeFactor(p);
    const mu = -k * elapsedYears * u_p;

    // Uncertainty
    // sigma(y) = PROGRESS_SIGMA0 * sqrt(elapsedYears) * (1 - 0.05 * optimism_factor_normalized?)
    // Let's scale uncertainty reduction similarly.
    const sigma = PROGRESS_SIGMA0 * Math.sqrt(elapsedYears) * (1 - 0.1 * optimismFactoryLimited(optimism));

    // Z score for quantile
    const z_q = getZScoreForCentile(quantileKey);

    // r_q(y,p) = exp(mu + z_q * sigma)
    const r = Math.exp(mu + z_q * sigma);

    // Clamp r in [0.01, 1.20]. Allow it to go lower for LEV deep impact.
    return Math.min(1.20, Math.max(0.01, r));
}

function optimismFactoryLimited(opt: number): number {
    return Math.max(-1, Math.min(1, opt * 0.1));
}

// 6. LEV parameters & PMF
export type LevParams = {
    medianYear: number;
    probMass: number[]; // Index 0 = currentYear
};

export function computeLevDistribution(
    targetScore: number,
    optimism: number,
    currentYear: number
): LevParams {
    // If no progress (-100%), LEV is impossible (or effectively infinite)
    if (optimism <= -10) {
        return { medianYear: 9999, probMass: [] };
    }

    // LEV Dates per user spec:
    // 95th percentile => Base (2040 default?)
    // 75th => Base + 9
    // 50th => Base + 15
    // "Have 75th be 9 years after 95th percentile, and 50th percentile be 15 years after 95th percentile."

    // We determine which bracket the user falls into based on targetScore.
    // Or do we treat targetScore as the specific percentile?
    // "pLEV = clamp(targetScore/100, 0.5, 0.95)"

    // Let's interpolate shift based on score.
    // 95 -> 0 shift
    // 75 -> 9 shift
    // 50 -> 15 shift

    let shift = 0;
    if (targetScore >= 95) shift = 0;
    else if (targetScore >= 75) {
        // Interp 75..95 -> shift 9..0
        const t = (targetScore - 75) / (95 - 75);
        shift = 9 * (1 - t);
    } else if (targetScore >= 50) {
        // Interp 50..75 -> shift 15..9
        const t = (targetScore - 50) / (75 - 50);
        shift = 15 - (15 - 9) * t;
    } else {
        // Score < 50 (Laggards/Refusers)
        // 50 -> 15 years
        // 5  -> Infinite or very long (e.g. 100 years)?
        // Let's interp 5..50 => shift 60..15
        const s = Math.max(1, targetScore);
        const t = (s - 1) / (50 - 1);
        shift = 60 - (60 - 15) * t;
        // This ensures Score 9 gets ~50 year lag (LEV 2100+), preventing accidental rejuvenation.
    }

    // Base LEV 95th year (Optimism affects this?)
    // "Next to optimism slider it should show the corresponding assumption dates... As you change that it should also update"
    // So Optimism shifts the *Effective* LEV year earlier/later?
    // Usually optimism makes it earlier.
    // Let's say baseline 0 optimism => 2040 for 95th.
    // +5 (50% faster) => Earlier.
    // -10 (no progress) => Infinite?

    // Inverse Speed Ramp
    // Time to LEV scales inversely with progress speed.
    // Speed factor: k = 1 + 0.1 * optimism.
    // Base LEV Year (95th) = 2040.
    // Base Delay = 2040 - currentYear.
    // Score Shift (0, 9, 15) is also a delay caused by frailty lag.
    // Total Base Delay = (2040 - currentYear) + shift.
    // Adjusted Delay = Total Base Delay / SpeedFactor.

    // speedFactor
    let speedFactor = 1 + 0.1 * optimism;
    if (speedFactor <= 0.01) speedFactor = 0.001; // Avoid div/0, effectively infinite

    const baseDelay95 = Math.max(0, LEV_MEDIAN_95 - currentYear);
    const totalBaseDelay = baseDelay95 + shift; // shift is 0, 9, or 15
    const adjustedDelay = totalBaseDelay / speedFactor;

    const m = currentYear + adjustedDelay;

    const probMass: number[] = [];
    const maxEvalYear = currentYear + 120;

    for (let y = currentYear; y <= maxEvalYear; y++) {
        // CDF(y)
        const cdfCurrent = 1 / (1 + Math.exp(-LEV_K * (y - m)));
        // CDF(y-1)
        const cdfPrev = 1 / (1 + Math.exp(-LEV_K * (y - 1 - m)));
        probMass.push(cdfCurrent - cdfPrev);
    }

    return { medianYear: m, probMass };
}

// 7. Pace of aging
// Returns pace value for a given year
export function getPaceOfAging(
    year: number,
    score: number, // targetScore
    quantileKey: number, // usually 50 for median
    optimism: number,
    horizonYear: number,
    currentYear: number,
    levMedianYear: number
): number {
    const yLEV = Math.round(levMedianYear);
    const pTarget = score; // integer 1..99 passed to helpers
    const zScoreVal = getFrailtyMultiplier(pTarget);

    // paceBase
    const r_q = getProgressMultiplier(year, pTarget, quantileKey, optimism, horizonYear, currentYear);
    // Important: The text says paceBase uses r_50, but then "Final pace for a given progress quantile q uses r_q".
    // The rejuvenation logic depends on `paceBase(yLEV)` which implies using 50th percentile (or the specific quantile?). 
    // Let's assume we want Rejuvenation to lock in based on the Scenario's "Median Expectation", so we define Lambda using the Median trajectory,
    // but apply it to the specific quantile trajectory? 
    // Text says: "Compute lambda so pace crosses 0 at yLEV... lambda = paceBase(yLEV) + REJUV_EXTRA".
    // paceBase is defined as zScore(pTarget) * r_50(y, pTarget).

    // So we need distinct calls.
    // First compute base at yLEV using median progress 50
    const r_lev_median = getProgressMultiplier(yLEV, pTarget, 50, optimism, horizonYear, currentYear);
    const paceBaseAtLev = zScoreVal * r_lev_median;
    const lambda = paceBaseAtLev + REJUV_EXTRA;

    // L(y)
    let L = 0;
    // Only apply Rejuvenation/LEV pull if there is actual progress (Optimism > -10)
    // "No LEV should be achieved... pace of aging will remain the same"
    if (year >= yLEV && optimism > -10) {
        L = lambda * (1 - Math.exp(-(year - yLEV) / REJUV_TAU));
    }

    const paceValid = zScoreVal * r_q - L;
    return Math.min(2.00, Math.max(-0.50, paceValid));
}

// 8. Health Index
export function bioAgeToHealth(bioAge: number): number {
    return 1 / (1 + Math.exp((bioAge - HEALTH_MIDPOINT_BIOAGE) / HEALTH_STEEPNESS));
}

// ------------------------------------------------------------------
// 9. Cohort Generation
// ------------------------------------------------------------------
export type SimulationResult = {
    survival: number[];     // Cumulative S(a)
    annualSurvival: number[]; // P(survive a -> a+1)
    bioAge: number[];       // Biological Age B(a)
    health: number[];       // H(a)
    aliveHealthy: number[]; // S(a)*H(a)
    pace: number[];         // pace(year_a)
    lifeExpectancy: number;
    healthExpectancy: number;
    isIndefinite?: boolean;
};

export function simulateCohort(
    startAge: number,
    _sex: 'male' | 'female',
    startScore: number,
    targetScore: number,
    horizonYear: number,
    optimism: number,
    lifeTable: LifeTable,
    currentYear: number,
    isProtocol: boolean, // If true, enables rejuvenation logic
    progressQuantile: number = 50 // 5, 25, 50, 75, 95
): SimulationResult {

    const survival: number[] = [];
    const annualSurvival: number[] = [];
    const bioAge: number[] = [];
    const health: number[] = [];
    const aliveHealthy: number[] = [];
    const paceArray: number[] = [];

    // Initialize
    let S = 1.0;
    // Initial Biological Age depends on Start Score (Current Health)
    // If score is median (50), mult is 1.0 -> B = startAge.
    // If score is low (1), mult is 1.37 -> B > startAge (Older biologically).
    let B = startAge * getFrailtyMultiplier(startScore);

    // Pre-calculate LEV median for Rejuvenation logic if protocol
    let levMedian = 0;
    if (isProtocol) {
        const levParams = computeLevDistribution(targetScore, optimism, currentYear);
        levMedian = levParams.medianYear;
    }

    // Iterate ages
    // map age index relative to startAge
    // result arrays will be 0..(MAX_AGE_INTERNAL - startAge)

    // However, usually we want to plot userAge..MAX.
    // The output arrays should probably align with index 0 = userAge.

    // Initial state at userAge
    survival.push(S);
    bioAge.push(B);
    // Annual survival for *previous* year? Or current year (t -> t+1)?
    // For T=0, we haven't survived T=0->1 yet. We don't have a value until we compute qFinal.
    // But for plotting, we usually want a value at T=0. Let's start with ~1.0 or undefined, then push loop values.
    // Or, we render loop values.
    // Let's explicitly push a "current annual survival" based on initial frailty?
    // qBase(startAge).
    // Let's effectively fill it in the loop.
    // But we need array length to match `survival` for easy D3 usage?
    // `survival` has N+1 entries (0..N). `annual` corresponds to intervals. 
    // We'll push current q(start) first.

    health.push(bioAgeToHealth(B));
    aliveHealthy.push(S * bioAgeToHealth(B));

    // Pace at current year
    const initialPace = isProtocol
        ? getPaceOfAging(currentYear, targetScore, progressQuantile, optimism, horizonYear, currentYear, levMedian)
        : getFrailtyMultiplier(startScore) * getProgressMultiplier(currentYear, startScore, 50, optimism, horizonYear, currentYear);

    paceArray.push(initialPace);

    // Initial Annual Survival (for plotting t=0)
    // Estimate based on simple table qx
    // It will be overwritten/refined by loop logic for consistency, but for now push a placeholder
    // actually, let's just make the array 1 shorter or push the first computed value?
    // Better: Compute p_0 for the first point?
    // We can do it inside the loop if we restructure, but let's just push 1.0 for "Now" (you are alive).
    // Or strictly 1-q(startAge).
    const idx0 = Math.min(startAge, lifeTable.ages[lifeTable.ages.length - 1]);
    const q0 = lifeTable.qx[idx0] ?? 0.001;
    annualSurvival.push(1 - q0);

    // Loop
    for (let a = startAge; a < MAX_AGE_INTERNAL; a++) {
        const year = currentYear + (a - startAge);

        // 1. Calculate Pace for this year (affects BioAge for NEXT year)
        // text: B(y+1) = B(y) + pace(y)
        let p = 1.0; // pace

        // Linear interpolation of Score (Frailty) over first 10 years if Protocol
        // startScore -> targetScore
        let effectiveScore = isProtocol ? targetScore : startScore;
        if (isProtocol && (year - currentYear) < 10) {
            const t = (year - currentYear) / 10;
            effectiveScore = startScore + (targetScore - startScore) * t;
        }

        if (isProtocol) {
            // Note: getPaceOfAging uses effectiveScore for frailty zScore, but targetScore for LEV trajectory?
            // "Current Health should have effect on current pace of aging"
            // We should pass effectiveScore to getPaceOfAging as the 'score' param which drives zScore.
            p = getPaceOfAging(year, effectiveScore, progressQuantile, optimism, horizonYear, currentYear, levMedian);
        } else {
            // "Current scenario... uses progress quantile fixed at 50th"
            const zScore = getFrailtyMultiplier(effectiveScore);
            const r = getProgressMultiplier(year, effectiveScore, 50, optimism, horizonYear, currentYear);
            p = zScore * r;
        }

        // Store pace for display (conceptually aligned with year/age)
        // Note: The loop runs for `a`. We pushed initial already. 
        // Wait, the result arrays need to cover the full range.
        // If we pushed for `startAge`, we need to compute for `startAge+1` etc.

        // 2. Mortality Hazard
        // h0(a) -> h0(B) (Biological Age determines base mortality)
        // Need to find qx for age `B` from table
        const ageIdx = Math.max(0, Math.floor(B));
        const tableIdx = Math.min(ageIdx, lifeTable.ages[lifeTable.ages.length - 1]);
        const qBase = lifeTable.qx[tableIdx] ?? 0.99;
        const h0 = qToH(qBase);

        // Hazard Multiplier
        // mult(a,q) = zScore(pScenario) * r_q(y, pScenario)
        // Optional coupling: If pace negative, reduce hazard
        let mult = 0;
        const zScore = getFrailtyMultiplier(effectiveScore);
        if (isProtocol) {
            const r = getProgressMultiplier(year, effectiveScore, progressQuantile, optimism, horizonYear, currentYear);
            mult = zScore * r;
            if (p < 0) {
                // Aggressive protection when pace < 0 to show "Indefinite" possibility
                // Reduce hazard exponentially with negative pace
                mult = mult * Math.exp(2.0 * p); // p is neg, so exp(neg big) -> 0
            }
        } else {
            const r = getProgressMultiplier(year, effectiveScore, 50, optimism, horizonYear, currentYear);
            mult = zScore * r;
        }

        const hFinal = h0 * Math.max(0.05, Math.min(2.5, mult));
        const qFinal = Math.min(0.999, hToQ(hFinal));

        // 3. Update State for NEXT step (a+1)
        S = S * (1 - qFinal);
        B = B + p;

        // Push new values
        // We are generating values for userAge+1 ... MAX
        // Actually, let's keep array index 0 = userAge.
        // So we just computed state for `a+1`.
        survival.push(S);
        // Annual Survival for this step was 1-qFinal
        annualSurvival.push(1 - qFinal);

        bioAge.push(B);

        const H = bioAgeToHealth(B);
        health.push(H);
        aliveHealthy.push(S * H);
        paceArray.push(p); // This pace drove the transition from a to a+1
    }

    // Compute Expectations
    // E_lifeYears = sum S(a) starting from userAge...
    // Since S(userAge)=1 is included in sum, subtract 0.5? 
    // Or just sum. Discrete sum: e_x = sum_{k=1..inf} p_x.
    // Our array includes S(userAge)=1.
    // Usually e_0 = sum_{t=1} S_t. Or sum_{t=0} S_t - 0.5.
    // Let's just sum all S values (which represent probability of being alive at discrete age points) and subtract 0.5 for mid-year.
    const sumS = survival.reduce((acc, val) => acc + val, 0);
    const lifeExpectancy = sumS - 0.5;

    const sumSH = aliveHealthy.reduce((acc, _val, idx) => {
        // Check threshold on H?
        // "sum S(a,q) * I(H >= THRESHOLD)"
        // The definition says "Expected remaining healthy years".
        // Usually HALE is sum of S(x)*H(x) for health-adjusted.
        // But prompt says: I(H >= THRESHOLD). So it's HealthSPAN (years above threshold).
        const H_val = health[idx];
        if (H_val >= HEALTHSPAN_THRESHOLD) {
            return acc + survival[idx];
        }
        return acc;
    }, 0);
    const healthExpectancy = sumSH - 0.5;

    // Check for "Indefinite" condition
    // If median pace is significantly negative at the end of simulation, or survival remains high
    const lastPace = paceArray[paceArray.length - 1];
    const isIndefinite = isProtocol && (lastPace < -0.1 && survival[survival.length - 1] > 0.01);

    return {
        survival,
        annualSurvival,
        bioAge,
        health,
        aliveHealthy,
        pace: paceArray,
        lifeExpectancy,
        healthExpectancy,
        isIndefinite
    };
}

// 10. Probability of Achieving LEV
export function calculateLevProb(
    _userAge: number,
    score: number,
    optimism: number,
    _horizonYear: number,
    _lifeTable: LifeTable,
    currentYear: number,
    refSurvival: number[] // S(a) from the protocol median simulation
): number {
    const { probMass } = computeLevDistribution(score, optimism, currentYear); // index 0 is currentYear
    let pAchieve = 0;

    // sum AliveAtY * LEV_PMF(y)
    // y from currentYear to currentYear + 120
    // refSurvival index 0 corresponds to userAge (currentYear)

    for (let i = 0; i < probMass.length; i++) {
        const pmf = probMass[i]; // Probability LEV happens at year currentYear + i
        // Need prob of being alive at that time.
        // survival array index i corresponds to age userAge + i
        if (i < refSurvival.length) {
            pAchieve += refSurvival[i] * pmf;
        }
    }

    // Fundamental Difficulty Limit
    // "There is something fundamental that makes LEV much more difficult"
    // Cap strictly at 90% even with perfect survival.
    pAchieve *= 0.90;

    // Low Score Penalty
    // "Accelerating the drop in LEV probability for them under 20 longevity score"
    if (score < 20) {
        // Quadratic acceleration: 
        // Score 19 -> (0.95)^2 = 0.90x
        // Score 10 -> (0.50)^2 = 0.25x
        // Score 0  -> 0.00x
        const penalty = Math.pow(score / 20, 2);
        pAchieve *= penalty;
    }

    return pAchieve;
}
