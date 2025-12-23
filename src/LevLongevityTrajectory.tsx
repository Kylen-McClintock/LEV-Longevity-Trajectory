import { useState, useMemo, useEffect, useRef } from 'react';
import { line, area, curveMonotoneX } from 'd3-shape';
import { scaleLinear } from 'd3-scale';
import {
    embedSampleData
} from './lev_data_loader';
import {
    simulateCohort,
    calculateLevProb,
    computeLevDistribution
} from './lev_math';
import './LevLongevityTrajectory.css';

// ------------------------------------------------------------------
// Constants
// ------------------------------------------------------------------
const CHART_Height = 450;
const CHART_MARGIN = { top: 20, right: 20, bottom: 50, left: 60 };

type ViewMode = 'survival' | 'health' | 'aliveHealthy';

export default function LevLongevityTrajectory() {
    const [width, setWidth] = useState(800);
    const containerRef = useRef<HTMLDivElement>(null);

    // 1. Inputs
    const [age, setAge] = useState(35);
    const [sex, setSex] = useState<'male' | 'female'>('female');
    const [currentScore, setCurrentScore] = useState(50);
    const [targetScore, setTargetScore] = useState(75);
    const [horizonYear] = useState(2050); // Default to max since slider is removed
    const [optimism, setOptimism] = useState(0); // -2..2
    const [viewMode, setViewMode] = useState<ViewMode>('aliveHealthy');
    const [coneMode, setConeMode] = useState<'uncertainty' | 'protocol'>('uncertainty'); // NEW toggl state

    // Scrubber time
    const currentYear = new Date().getFullYear();
    const [scrubYear, setScrubYear] = useState(currentYear);
    const [isPlaying, setIsPlaying] = useState(false);
    const [showAnalysis, setShowAnalysis] = useState(false);

    // Load Data
    const lifeTable = useMemo(() => embedSampleData(sex), [sex]);

    // Handle Resize
    useEffect(() => {
        if (!containerRef.current) return;
        const resizeObserver = new ResizeObserver(entries => {
            for (let entry of entries) {
                setWidth(entry.contentRect.width);
            }
        });
        resizeObserver.observe(containerRef.current);
        return () => resizeObserver.disconnect();
    }, []);

    // Animation Loop
    useEffect(() => {
        let animId: number;
        let lastTime = performance.now();
        const TICK_MS = 250; // ms per year step? prompt: "250 ms per year step or similar"

        const loop = (now: number) => {
            if (!isPlaying) return;
            const dt = now - lastTime;
            if (dt >= TICK_MS) {
                setScrubYear(y => {
                    if (y >= currentYear + 100) {
                        setIsPlaying(false);
                        return currentYear;
                    }
                    return y + 1;
                });
                lastTime = now;
            }
            animId = requestAnimationFrame(loop);
        };

        if (isPlaying) {
            animId = requestAnimationFrame(loop);
        }
        return () => cancelAnimationFrame(animId);
    }, [isPlaying, currentYear]);


    // 2. Compute Cohorts
    // A) Current Status Quo (score=current, progress=50th no rejuv)
    const cohortCurrent = useMemo(() => {
        return simulateCohort(
            age, sex, currentScore, currentScore, horizonYear, optimism, lifeTable, currentYear, false, 50
        );
    }, [age, sex, currentScore, horizonYear, optimism, lifeTable, currentYear]);

    // B) Protocol Target (User Selected)
    const cohortTargetUser = useMemo(() => {
        return simulateCohort(
            age, sex, currentScore, targetScore, horizonYear, optimism, lifeTable, currentYear, true, 50
        );
    }, [age, sex, currentScore, targetScore, horizonYear, optimism, lifeTable, currentYear]);

    // Comparison Cohorts (Fixed Scores: 95, 75, 50, 25)
    // "See difference better longevity protocols have on outcomes"
    // All assume Median Medical Progress (50th percentile) to isolate protocol impact.
    // Comparison Cohorts (Fixed Scores: 95, 75, 50, 25)
    // "See difference better longevity protocols have on outcomes"
    // We assume these represent "Someone at that level", so we start them at that score to show steady-state difference immediately.
    const cohortScore25 = useMemo(() => simulateCohort(age, sex, 25, 25, horizonYear, optimism, lifeTable, currentYear, true, 50), [age, sex, horizonYear, optimism, lifeTable, currentYear]);
    const cohortScore50 = useMemo(() => simulateCohort(age, sex, 50, 50, horizonYear, optimism, lifeTable, currentYear, true, 50), [age, sex, horizonYear, optimism, lifeTable, currentYear]);
    const cohortScore75 = useMemo(() => simulateCohort(age, sex, 75, 75, horizonYear, optimism, lifeTable, currentYear, true, 50), [age, sex, horizonYear, optimism, lifeTable, currentYear]);
    const cohortScore95 = useMemo(() => simulateCohort(age, sex, 95, 95, horizonYear, optimism, lifeTable, currentYear, true, 50), [age, sex, horizonYear, optimism, lifeTable, currentYear]);

    // Cohorts for "Cone of Uncertainty" (Medical Progress Variability 5th-95th)
    const cohortFan5 = useMemo(() => simulateCohort(age, sex, currentScore, targetScore, horizonYear, optimism, lifeTable, currentYear, true, 5), [age, sex, currentScore, targetScore, horizonYear, optimism, lifeTable, currentYear]);
    const cohortFan25 = useMemo(() => simulateCohort(age, sex, currentScore, targetScore, horizonYear, optimism, lifeTable, currentYear, true, 25), [age, sex, currentScore, targetScore, horizonYear, optimism, lifeTable, currentYear]);
    const cohortFan75 = useMemo(() => simulateCohort(age, sex, currentScore, targetScore, horizonYear, optimism, lifeTable, currentYear, true, 75), [age, sex, currentScore, targetScore, horizonYear, optimism, lifeTable, currentYear]);
    const cohortFan95 = useMemo(() => simulateCohort(age, sex, currentScore, targetScore, horizonYear, optimism, lifeTable, currentYear, true, 95), [age, sex, currentScore, targetScore, horizonYear, optimism, lifeTable, currentYear]);

    // For fan rendering, we can use these as bounds if we want, or just plot the Reference Lines?
    // User asked for "Tech%" column in scrubber. I will use these cohorts for the scrubber.
    // I need to update the fanData to use these too if I want the fan to show the protocol spread.
    // "Fan bands ... 5-95". If we change to Protocol spread (25-95), it shows the range of outcomes based on choice.
    // I'll map survival/health of these for the fan background.
    // Note: 95th score is BEST (top line). 25th is WORST (bottom line).
    // So v95 should be cohortScore95, v25 should be cohortScore25.
    // (My previous quantile logic: 95th quantile was BEST progress).
    // So mapping is preserved direction-wise. High score = better.


    // 3. Stats Calculations
    // 3. Stats Calculations
    const levProbMedian = calculateLevProb(age, targetScore, optimism, horizonYear, lifeTable, currentYear, cohortTargetUser.survival);

    // Find target score for 50% LEV
    const targetFor50Lev = useMemo(() => {
        // Brute force 1..99
        let bestScore = 50;
        let minDiff = 1.0;
        // We assume default optimism=0 for this calc as per prompt "under default settings"
        // But user might have changed optimism. Prompt: "under default settings (median progress, optimism=0)"
        // So we fix optimism=0 for this metric? Or use current?
        // "Solve by searching targetScore... under default settings (median progress, optimism=0)."
        const opt0 = 0;

        // We need a helper to run the sim quickly.
        // Optimization: Just update levProb logic which depends on score.
        // Wait, levProb depends on Survival curve of the scenario?
        // The prompt says: "P_achieveLEV += AliveAtY * LEV_PMF(y)"
        // AliveAtY is S(ageAtY, protocol median quantile).
        // Protocol median depends on targetScore (frailty).
        // So we do need to re-run simulateCohort for score 1..99? That's expensive (99 * sim).
        // simulateCohort is fast enough (~200 iters). 99 * 200 = 20k ops. Trivial.

        for (let s = 1; s <= 99; s += 2) { // step by 2 for speed
            // Sim survival only
            const res = simulateCohort(age, sex, currentScore, s, horizonYear, opt0, lifeTable, currentYear, true, 50);
            const p = calculateLevProb(age, s, opt0, horizonYear, lifeTable, currentYear, res.survival);
            const diff = Math.abs(p - 0.5);
            if (diff < minDiff) {
                minDiff = diff;
                bestScore = s;
            }
        }
        return bestScore;
    }, [age, sex, horizonYear, lifeTable, currentYear, currentScore]); // Depends on age/sex/horizon/currentScore
    // Actually prompt says "targetScore from 1..99".


    // 4. Coordinates & Scales
    const innerWidth = Math.max(0, width - CHART_MARGIN.left - CHART_MARGIN.right);
    const innerHeight = Math.max(0, CHART_Height - CHART_MARGIN.top - CHART_MARGIN.bottom);

    // X Axis: Age. Domain 0..120 (Prompt: "Visible domain 0–150" but usually data gets thin. Let's do 0-120 or 140)
    // Prompt: "Visible domain 0–150."
    const maxVisAge = 140;
    const xScale = scaleLinear()
        .domain([0, maxVisAge])
        .range([0, innerWidth]);

    // Y Axis: 0..1 (Probability/Index)
    const yScale = scaleLinear()
        .domain([0, 1])
        .range([innerHeight, 0]);

    // Curve Generators
    const getCurveData = (cohort: typeof cohortCurrent) => {
        // cohort arrays start at index 0 -> age=age.
        // need to map to: [age + i, value]
        return cohort.survival.map((_, i) => {
            const a = age + i;
            let val = 0;
            if (viewMode === 'survival') val = cohort.annualSurvival[i]; // User req: Annual P(survival)
            else if (viewMode === 'health') val = cohort.health[i];
            else val = cohort.aliveHealthy[i];
            return [a, val] as [number, number];
        }).filter(d => d[0] <= maxVisAge);
    };

    const lineGen = line<any>()
        .x((d) => xScale(d[0]))
        .y((d) => yScale(d[1]))
        .curve(curveMonotoneX);

    const areaGen = area<any>()
        .x((d) => xScale(d.age))
        .y0((d) => yScale(d.y0))
        .y1((d) => yScale(d.y1))
        .curve(curveMonotoneX);

    // Prepare Fan Data
    // We need to zip arrays: age+i, y_5, y_25, ...
    // Prepare Fan Data
    // We need to zip arrays: age+i, y_5, y_25, ...
    const fanData = useMemo(() => {
        const source95 = coneMode === 'uncertainty' ? cohortFan95 : cohortScore95;
        const source75 = coneMode === 'uncertainty' ? cohortFan75 : cohortScore75;
        const source25 = coneMode === 'uncertainty' ? cohortFan25 : cohortScore25;
        const source5 = coneMode === 'uncertainty' ? cohortFan5 : cohortScore25; // Protocol comparison doesn't have 5th quantile generated, reuse 25 or need 5?
        // Actually, for protocol variance, we usually show 25-95 range.
        // Let's map: 
        // Uncertainty: 5, 25, 75, 95 (Medical Percentiles)
        // Protocol: 25, 50, 75, 95 (Score Percentiles) -> User 25 is "Low Adherence", 95 "High".
        // Let's use 25 as bottom for protocol fan to match cohorts.

        const len = Math.min(source95.survival.length, maxVisAge - age);
        const data = [];
        for (let i = 0; i < len; i++) {
            const a = age + i;
            const getVal = (c: typeof cohortCurrent) => {
                const val = (viewMode === 'survival') ? c.annualSurvival[i] : (viewMode === 'health') ? c.health[i] : c.aliveHealthy[i];
                return val ?? 0;
            };
            data.push({
                age: a,
                v5: coneMode === 'uncertainty' ? getVal(source5) : getVal(source25), // Use 25 as lower bound for protocol
                v25: getVal(source25),
                v75: getVal(source75),
                v95: getVal(source95),
            });
        }
        return data;
    }, [coneMode, cohortFan5, cohortFan25, cohortFan75, cohortFan95, cohortScore25, cohortScore75, cohortScore95, viewMode, age]);


    // Playhead / Scrubber
    const scrubAge = age + (scrubYear - currentYear);
    const scrubX = xScale(scrubAge);

    // Scrubber Tooltip Values
    const scrubIndex = Math.max(0, scrubYear - currentYear);
    // Safely get values from target median
    const scrubValues = {
        survival: cohortTargetUser.annualSurvival[scrubIndex] ?? 0,
        health: cohortTargetUser.health[scrubIndex] ?? 0,
        aliveHealthy: cohortTargetUser.aliveHealthy[scrubIndex] ?? 0,
        pace: cohortTargetUser.pace[scrubIndex] ?? 0,
        pace25: cohortFan25.pace[scrubIndex] ?? 0,
        pace75: cohortFan75.pace[scrubIndex] ?? 0,
        pace95: cohortFan95.pace[scrubIndex] ?? 0
    };


    return (
        <div className="lev-container">
            <div className="lev-header">
                <h1 className="lev-title">Path to Longevity Escape Velocity</h1>
                <div className="lev-subtitle">Actuarial Forecast & Protocol Impact Model</div>
            </div>

            {/* Top Controls */}
            <div className="lev-controls-grid">
                <div className="lev-control-group">
                    <label className="lev-label">Demographics</label>
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                        <span className="lev-value">Age {age}</span>
                        <input type="range" min={0} max={100} value={age}
                            onChange={e => setAge(Number(e.target.value))} className="lev-slider" />
                    </div>
                    <div className="lev-toggle-group">
                        <button className={`lev-toggle-btn ${sex === 'female' ? 'active' : ''}`} onClick={() => setSex('female')}>Female</button>
                        <button className={`lev-toggle-btn ${sex === 'male' ? 'active' : ''}`} onClick={() => setSex('male')}>Male</button>
                    </div>
                </div>

                <div className="lev-control-group">
                    <label className="lev-label">
                        Current Health
                        <span style={{ fontSize: 9, opacity: 0.5, marginLeft: 6, fontWeight: 'normal' }}>
                            (Relative to other people your age)
                        </span>
                    </label>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span className="lev-value">Score {currentScore}</span>
                        <span style={{ fontSize: 10, opacity: 0.5 }}>Median = 50</span>
                    </div>
                    <input type="range" min={1} max={99} value={currentScore}
                        onChange={e => setCurrentScore(Number(e.target.value))} className="lev-slider" />
                </div>

                <div className="lev-control-group">
                    <label className="lev-label" style={{ color: '#78B999' }}>Protocol Target</label>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span className="lev-value" style={{ color: '#78B999' }}>Score {targetScore}</span>
                        <span style={{ fontSize: 10, opacity: 0.5 }}>Needed for 50% LEV: ~{targetFor50Lev}</span>
                    </div>
                    <input type="range" min={1} max={99} value={targetScore}
                        onChange={e => setTargetScore(Number(e.target.value))} className="lev-slider" />
                </div>

                <div className="lev-control-group">
                    <label className="lev-label">
                        Cone of Uncertainty
                    </label>
                    <div className="lev-toggle-group" style={{ marginTop: 4 }}>
                        <button
                            className={`lev-toggle-btn ${coneMode === 'uncertainty' ? 'active' : ''}`}
                            onClick={() => setConeMode('uncertainty')}
                            style={{ fontSize: 9, padding: '4px 8px' }}
                        >
                            Medical Progress
                        </button>
                        <button
                            className={`lev-toggle-btn ${coneMode === 'protocol' ? 'active' : ''}`}
                            onClick={() => setConeMode('protocol')}
                            style={{ fontSize: 9, padding: '4px 8px' }}
                        >
                            Protocol Variance
                        </button>
                    </div>
                </div>

                <div className="lev-control-group">
                    <label className="lev-label">Progress Optimism</label>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
                        <span className="lev-value">
                            {optimism === 0 ? 'Baseline' : optimism > 0 ? `+${optimism * 10}%` : `${optimism * 10}%`} Speed
                        </span>

                        {/* LEV Assumption Dates Display */}
                        <div style={{ textAlign: 'right', fontSize: 10, opacity: 0.6, lineHeight: 1.2 }}>
                            {(() => {
                                const m95 = computeLevDistribution(95, optimism, currentYear).medianYear;
                                const m50 = computeLevDistribution(50, optimism, currentYear).medianYear;
                                return (
                                    <>
                                        <div>LEV 95%: {m95 >= 9000 ? 'Never' : `~${Math.round(m95)}`}</div>
                                        <div>LEV 50%: {m50 >= 9000 ? 'Never' : `~${Math.round(m50)}`}</div>
                                    </>
                                );
                            })()}
                        </div>
                    </div>

                    <input type="range" min={-10} max={5} step={1} value={optimism}
                        onChange={e => setOptimism(Number(e.target.value))} className="lev-slider" />
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, opacity: 0.3, marginTop: 4 }}>
                        <span>No Progress (-100%)</span><span>Faster (+50%)</span>
                    </div>
                </div>
            </div>

            {/* Main Layout */}
            <div className="lev-main-layout">

                {/* Left: Chart */}
                <div className="lev-chart-area" ref={containerRef}>
                    {/* Toolbar inside chart */}
                    <div style={{ position: 'absolute', top: 16, right: 16, zIndex: 10 }}>
                        <div className="lev-toggle-group">
                            <button className={`lev-toggle-btn ${viewMode === 'survival' ? 'active' : ''}`} onClick={() => setViewMode('survival')}>Survival</button>
                            <button className={`lev-toggle-btn ${viewMode === 'health' ? 'active' : ''}`} onClick={() => setViewMode('health')}>Health</button>
                            <button className={`lev-toggle-btn ${viewMode === 'aliveHealthy' ? 'active' : ''}`} onClick={() => setViewMode('aliveHealthy')}>Alive+Healthy</button>
                        </div>
                    </div>

                    <svg width={width} height={CHART_Height}>
                        <g transform={`translate(${CHART_MARGIN.left}, ${CHART_MARGIN.top})`}>

                            {/* Grid/Axes */}
                            <line x1={0} y1={innerHeight} x2={innerWidth} y2={innerHeight} stroke="white" strokeOpacity={0.2} />
                            <line x1={0} y1={innerHeight} x2={innerWidth} y2={innerHeight} stroke="white" strokeOpacity={0.2} />
                            <line x1={0} y1={0} x2={0} y2={innerHeight} stroke="white" strokeOpacity={0.2} />

                            {/* Y Axis Label */}
                            <text
                                transform={`rotate(-90)`}
                                x={-innerHeight / 2}
                                y={-35}
                                fill="white"
                                fillOpacity={0.6}
                                fontSize={10}
                                textAnchor="middle"
                            >
                                {viewMode === 'survival' ? 'Survival Probability (%)' :
                                    viewMode === 'health' ? 'Health Index (%)' :
                                        'Alive + Healthy Probability (%)'}
                            </text>

                            {/* X Ticks (Age) */}
                            {xScale.ticks(10).map(t => (
                                <g key={t} transform={`translate(${xScale(t)}, ${innerHeight})`}>
                                    <line y2={6} stroke="white" strokeOpacity={0.2} />
                                    <text y={20} fill="white" fillOpacity={0.5} fontSize={10} textAnchor="middle">{t}</text>
                                    {/* Calendar Year below */}
                                    <text y={32} fill="white" fillOpacity={0.3} fontSize={9} textAnchor="middle">
                                        {currentYear + (t - age)}
                                    </text>
                                </g>
                            ))}

                            {/* Y Ticks */}
                            {yScale.ticks(5).map(t => (
                                <g key={t} transform={`translate(0, ${yScale(t)})`}>
                                    <line x2={-6} stroke="white" strokeOpacity={0.2} />
                                    <text x={-10} dy={3} fill="white" fillOpacity={0.5} fontSize={10} textAnchor="end">
                                        {t * 100}%
                                    </text>
                                </g>
                            ))}

                            {/* Today Marker */}
                            <line x1={xScale(age)} y1={0} x2={xScale(age)} y2={innerHeight}
                                stroke="white" strokeDasharray="4 4" strokeOpacity={0.3} />
                            <text x={xScale(age)} y={-8} fill="white" fillOpacity={0.5} fontSize={10} textAnchor="middle">
                                Today ({age})
                            </text>

                            {/* Fan Bands (Target) */}
                            {/* 5-95 */}
                            <path d={areaGen.y0((d: any) => yScale(d.v5)).y1((d: any) => yScale(d.v95))(fanData) || ''}
                                fill="#78B999" fillOpacity={0.08} />
                            {/* 25-75 */}
                            <path d={areaGen.y0((d: any) => yScale(d.v25)).y1((d: any) => yScale(d.v75))(fanData) || ''}
                                fill="#78B999" fillOpacity={0.18} />

                            {/* Current Scenario Line (Dashed) */}
                            <path d={lineGen(getCurveData(cohortCurrent)) || ''}
                                fill="none" stroke="#E89A6B" strokeWidth={2} strokeOpacity={0.8} strokeDasharray="6 4" />

                            {/* User Selection Line */}
                            <path d={lineGen(getCurveData(cohortTargetUser)) || ''}
                                fill="none" stroke="#78B999" strokeWidth={3} />

                            {/* Scrubber Line */}
                            <g transform={`translate(${scrubX}, 0)`}>
                                <line y2={innerHeight} stroke="white" strokeWidth={1} />
                                <circle cy={yScale(scrubValues[viewMode])} r={4} fill="white" />
                            </g>
                        </g>

                        {/* Legend Overlay - Moved to top left or handled better to avoid overlap */}
                        <g transform={`translate(${CHART_MARGIN.left + 20}, ${CHART_MARGIN.top + 20})`}>
                            <rect width="180" height="50" fill="black" fillOpacity="0.6" rx="4" />
                            <g transform="translate(10, 20)">
                                <line x2="20" stroke="#E89A6B" strokeDasharray="6 4" strokeWidth="2" />
                                <text x="28" y="4" fill="#E89A6B" fontSize="10">Status Quo</text>
                            </g>
                            <g transform="translate(10, 40)">
                                <line x2="20" stroke="#78B999" strokeWidth="3" />
                                <text x="28" y="4" fill="#78B999" fontSize="10">Protocol Target</text>
                            </g>
                        </g>
                    </svg>

                    {/* Graph Description Below X-Axis */}
                    <div style={{ marginTop: -10, marginLeft: CHART_MARGIN.left, maxWidth: innerWidth, fontSize: 10, color: 'rgba(255,255,255,0.6)', lineHeight: 1.4 }}>
                        {viewMode === 'survival' && (
                            <>
                                <strong>Survival Probability:</strong> The likelihood of being alive at a given age.
                                Standard mortality tables show a rapid decline after age 80 (Gompertz Law).
                                LEV protocols aim to "square the curve" and push the right-side tail indefinitely.
                            </>
                        )}
                        {viewMode === 'health' && (
                            <>
                                <strong>Health Index:</strong> A measure of physiological integrity (0-100%).
                                Unlike binary survival, this tracks quality of life.
                                Rejuvenation therapies aim to keep this index high (&gt;80%) even as chronological age increases.
                            </>
                        )}
                        {viewMode === 'aliveHealthy' && (
                            <>
                                <strong>Alive & Healthy Probability:</strong> The combined probability of being both alive AND in a robust health state.
                                This is the strict "Healthspan" metric. In a true LEV scenario, this curve should rise to meet the survival curve (Compression of Morbidity).
                            </>
                        )}
                    </div>
                </div>


                {/* Right: Side Panel */}
                <div className="lev-side-panel">

                    <div className="lev-stat-card">
                        <div className="lev-stat-title">LEV PROBABILITY</div>
                        <div className="lev-stat-value" style={{ color: '#52A7C3' }}>
                            {(levProbMedian * 100).toFixed(1)}%
                        </div>
                        <div className="lev-stat-sub">
                            Chance of indefinite lifespan via escape velocity
                        </div>
                    </div>

                    <div className="lev-stat-card">
                        <div className="lev-stat-title">EXPECTED LIFESPAN</div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                            <div>
                                <div className="lev-stat-value">
                                    {Math.round(age + cohortCurrent.lifeExpectancy)}
                                </div>
                                <div className="lev-stat-sub">Status Quo</div>
                            </div>
                            <div>
                                <div className="lev-stat-value" style={{ color: '#78B999' }}>
                                    {levProbMedian > 0.5 ? 'Indefinite' : Math.round(age + cohortTargetUser.lifeExpectancy)}
                                </div>
                                <div className="lev-stat-sub">Protocol</div>
                            </div>
                        </div>
                    </div>

                    <div className="lev-stat-card">
                        <div className="lev-stat-title">HEALTHSPAN</div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                            <div>
                                <div className="lev-stat-value">
                                    {Math.round(age + cohortCurrent.healthExpectancy)}
                                </div>
                                <div className="lev-stat-sub">Status Quo</div>
                            </div>
                            <div>
                                <div className="lev-stat-value" style={{ color: '#78B999' }}>
                                    {cohortTargetUser.isIndefinite ? 'Indefinite' : Math.round(age + cohortTargetUser.healthExpectancy)}
                                </div>
                                <div className="lev-stat-sub">Protocol</div>
                            </div>
                        </div>
                    </div>

                    {/* Scrubber Table Moved to Bottom */}

                    <div className="lev-stat-card">
                        <div className="lev-stat-title" style={{ marginBottom: 8 }}>SCENARIO LEV DATES (Median)</div>
                        {(() => {
                            const m95 = computeLevDistribution(95, optimism, currentYear).medianYear;
                            const m50 = computeLevDistribution(50, optimism, currentYear).medianYear;
                            const isNever = m95 >= 9000;

                            const renderDate = (m: number, label: string) => (
                                <div style={{ marginBottom: 8 }}>
                                    <div style={{ fontSize: 11, opacity: 0.7 }}>{label}</div>
                                    <div style={{ color: isNever ? 'rgba(255,255,255,0.4)' : '#D4AF37', fontSize: 18, fontWeight: 600 }}>
                                        {isNever ? 'Never' : Math.round(m)}
                                    </div>
                                </div>
                            );

                            return (
                                <div>
                                    {renderDate(m95, "Median LEV Arrival Date for 95th longevity percentile")}
                                    {renderDate(m50, "Median LEV Arrival Date for 50th longevity percentile")}
                                </div>
                            );
                        })()}
                        <div className="lev-stat-sub">
                            {optimism === 0 ? 'Based on Baseline Speed' : `Based on Progress Optimism ${optimism > 0 ? '+' : ''}${optimism * 10}%`}
                        </div>
                    </div>

                    <div className="lev-play-controls">
                        <button className="lev-play-btn" onClick={() => setIsPlaying(!isPlaying)}>
                            {isPlaying ? '⏸' : '▶'}
                        </button>
                        <div className="lev-scrub-slider">
                            <input type="range"
                                min={currentYear} max={currentYear + 100}
                                value={scrubYear}
                                onChange={e => {
                                    setScrubYear(Number(e.target.value));
                                    setIsPlaying(false);
                                }}
                                className="lev-slider"
                                style={{ width: '100%' }}
                            />
                            <div style={{ textAlign: 'center', fontSize: 10, marginTop: 4, opacity: 0.5 }}>
                                Scrub Year
                            </div>
                        </div>
                    </div>

                    <div style={{ fontSize: 10, opacity: 0.3, marginTop: 20, lineHeight: 1.4 }}>
                        Population-level projections and forecast scenarios. Results vary and are not guaranteed.
                        Optimism {optimism > 0 ? '+' : ''}{optimism} corresponds to {optimism > 0 ? '+' : ''}{optimism * 20}% med speed.
                    </div>

                </div>
            </div> {/* Close lev-main-layout */}

            {/* Bottom: Detailed Scrubber Data */}
            <div style={{ marginTop: 20, background: 'rgba(0,0,0,0.3)', borderRadius: 8, padding: 16, border: '1px solid rgba(255,255,255,0.1)' }}>
                <div className="lev-stat-title" style={{ marginBottom: 12 }}>
                    SCENARIO DETAILS AT YEAR {scrubYear} (Chronological Age {Math.floor(scrubAge)})
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'minmax(120px, 1fr) 1fr 1fr 1fr 1fr', gap: 10, fontSize: 11, marginBottom: 8, borderBottom: '1px solid rgba(255,255,255,0.2)', paddingBottom: 6, opacity: 0.7 }}>
                    <div>LONGEVITY SCORE</div>
                    <div style={{ textAlign: 'right' }}>BIOLOGICAL AGE</div>
                    <div style={{ textAlign: 'right' }}>PACE OF AGING</div>
                    <div style={{ textAlign: 'right' }}>ANNUAL SURVIVAL</div>
                    <div style={{ textAlign: 'right' }}>HEALTH INDEX</div>
                </div>

                {[95, 75, 50, 25].map(q => {
                    const c = q === 95 ? cohortScore95 : q === 75 ? cohortScore75 : q === 50 ? cohortScore50 : cohortScore25;
                    const p = c.pace[scrubIndex] ?? 0;
                    const s = c.annualSurvival[scrubIndex] ?? 0;
                    const h = c.health[scrubIndex] ?? 0;
                    const b = c.bioAge[scrubIndex] ?? age; // default to chron age if missing

                    const isMed = q === targetScore; // Highlight matches user
                    const col = isMed ? '#78B999' : 'rgba(255,255,255,0.5)';
                    const bg = isMed ? 'rgba(120, 185, 153, 0.1)' : 'transparent';

                    return (
                        <div key={q} style={{ display: 'grid', gridTemplateColumns: 'minmax(120px, 1fr) 1fr 1fr 1fr 1fr', gap: 10, fontSize: isMed ? 13 : 12, padding: '6px 0', fontWeight: isMed ? 600 : 400, color: col, backgroundColor: bg, alignItems: 'center' }}>
                            <div>{q}th Percentile</div>
                            <div style={{ textAlign: 'right' }}>{b.toFixed(1)}</div>
                            <div style={{ textAlign: 'right', color: p < 0 ? '#52A7C3' : 'inherit' }}>{p.toFixed(2)} / yr</div>
                            <div style={{ textAlign: 'right' }}>{(s * 100).toFixed(1)}%</div>
                            <div style={{ textAlign: 'right' }}>{h.toFixed(2)}</div>
                        </div>
                    )
                })}
            </div>

            {/* Model Analysis & Methodology */}
            <div style={{ marginTop: 20, borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: 20 }}>
                <button
                    onClick={() => setShowAnalysis(!showAnalysis)}
                    style={{
                        background: 'none', border: 'none', color: '#78B999',
                        fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
                        padding: 0
                    }}
                >
                    <span style={{ fontSize: 14 }}>{showAnalysis ? '▼' : '▶'}</span>
                    MODEL ANALYSIS & METHODOLOGY
                </button>

                {showAnalysis && (
                    <div style={{ marginTop: 16, fontSize: 11, lineHeight: 1.6, color: 'rgba(255,255,255,0.8)', maxWidth: 800 }}>

                        <h4 style={{ color: 'white', marginTop: 0, marginBottom: 8 }}>1. Defining the Inputs: Longevity Score & Pace of Aging</h4>
                        <p style={{ marginBottom: 12 }}>
                            The primary input, the "Longevity Protocol Score", is not arbitrary. It represents a percentile ranking on the <strong>Pace of Aging</strong> distribution (calibrated against benchmarks like DunedinPACE).
                            <br />
                            A <strong>95th Percentile Score</strong> does not just mean "healthy habits"—it mathematically defines an individual whose biological aging rate is slower than 95% of the population (e.g., aging at 0.68 biological years per calendar year). Conversely, a 5th percentile score implies accelerated aging (&gt;1.3 years/year). This slope is the fundamental variable that battles against the Gompertz curve.
                        </p>

                        <h4 style={{ color: 'white', marginTop: 16, marginBottom: 8 }}>2. The Math of LEV: Escaping the Gompertz Curve</h4>
                        <p style={{ marginBottom: 12 }}>
                            Longevity Escape Velocity (LEV) is defined as the point where the <strong>Rate of Rejuvenation</strong> (from medical progress) exceeds the <strong>Rate of Damage Accumulation</strong> (Pace of Aging).
                            <br />
                            Our model computes this year-over-year. For individuals with a slow Pace of Aging (Scores &gt;90), the "escape velocity" required is lower—they are moving targets that are easier to catch. For those with accelerated aging (Scores &lt;20), the medical technology must be exponentially more powerful to reverse their rapid damage accumulation, making LEV significantly harder to achieve.
                        </p>

                        <h4 style={{ color: 'white', marginTop: 16, marginBottom: 8 }}>3. Adoption Lags: The Diffusion of Innovation</h4>
                        <p style={{ marginBottom: 12 }}>
                            Science is not distributed instantly. We model the <strong>Time Lag</strong> between a theoretical breakthrough and its application to the user based on the <strong>Rogers Diffusion of Innovation Curve</strong>:
                            <ul style={{ paddingLeft: 16, marginTop: 4 }}>
                                <li><strong>Innovators (95th+ Percentile):</strong> 0-year lag. They access therapies via trials, off-label use, or medical tourism immediately upon viability.</li>
                                <li><strong>The Majority (50th Percentile):</strong> ~15-year lag. They must wait for regulatory approval (FDA), insurance negotiation, and standard-of-care guidances.</li>
                                <li><strong>Laggards & Refusers (5th Percentile):</strong> Infinite or extreme lag. Due to skepticism, cost, or ideology, they may never adopt rejuvenation therapies, rendering their LEV probability near zero even in a technological utopia.</li>
                            </ul>
                        </p>

                        <h4 style={{ color: 'white', marginTop: 16, marginBottom: 8 }}>4. The "Stacked" Disadvantage: Initial State vs. Rate</h4>
                        <p style={{ marginBottom: 12 }}>
                            The model distinguishes between <strong>Intercept (Initial BioAge)</strong> and <strong>Slope (Pace of Aging)</strong>. A low score penalizes the user twice:
                            <br />
                            1. <strong>Higher Initial BioAge:</strong> A 40-year-old with a Score of 20 starts with the frailty hazards of a 55-year-old.
                            <br />
                            2. <strong>Faster Decay:</strong> They continue to accumulate damage faster than normal.
                            <br />
                            This compounding effect explains why the survival curves for low-score individuals collapse so dramatically compared to the baseline.
                        </p>

                        <h4 style={{ color: 'white', marginTop: 16, marginBottom: 8 }}>5. Modeling Uncertainty: Brownian Motion</h4>
                        <p style={{ marginBottom: 12 }}>
                            The "Fan Bands" (Green zones) represent the cone of uncertainty in future medical progress. We predict progress using a stochastic process (Geometric Brownian Motion) where the "Optimism" slider adjusts the <strong>Drift</strong> (mean speed) and the nature of discovery implies a <strong>Volatility</strong> (Sigma). Looking further into the future (Horizon Year) naturally widens this cone, as long-term prediction errors compound.
                        </p>

                        <h4 style={{ color: 'white', marginTop: 16, marginBottom: 8 }}>6. The Fundamental Limit: 90% Cap</h4>
                        <p style={{ marginBottom: 12 }}>
                            Finally, we enforce a "Hard Reality" cap. Even if the math allows for 100% survival, we cap LEV probability at 90%. This accounts for <strong>Systems Biology limitations</strong>—unknown failure modes (e.g., lysosomal aggregates, nuclear mutations, or non-biological risks) that current "Damage Repair" paradigms (SENS) do not account for. It acknowledges that biology often has a "weakest link" that no amount of optimism can assume away.
                        </p>

                        <div style={{ marginTop: 20, fontSize: 10, opacity: 0.5, borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: 8 }}>
                            <em>Disclaimer: This model is a probabilistic simulation using simplified mathematical abstractions of demographic and biological processes. It is for educational exploration only and does not constitute a guaranteed medical forecast.</em>
                        </div>

                        <h4 style={{ color: '#78B999', marginTop: 24, marginBottom: 8, borderTop: '1px solid rgba(120, 185, 153, 0.3)', paddingTop: 16 }}>PART 2: DEEP DIVE & ASSUMPTIONS</h4>

                        <h4 style={{ color: 'white', marginTop: 16, marginBottom: 8 }}>7. Critical Assumptions & Sensitivity</h4>
                        <p style={{ marginBottom: 12 }}>
                            Every model relies on priors. Here are ours, ranked by certainty and impact:
                            <ul style={{ paddingLeft: 16, marginTop: 4 }}>
                                <li><strong>The "Gompertz Limit" (High Certainty, High Impact):</strong> We assume mortality doubles every ~8 years. If LEV therapies fail to break this exponential curve, indefinite lifespans are mathematically impossible regardless of lifestyle.</li>
                                <li><strong>Progress Rate (Low Certainty, Critical Impact):</strong> We assume a baseline compounding rate of 1.8% per year for "damage repair efficiency." Changing this via the <strong>Optimism Slider</strong> is the most sensitive variable in the model—a shift to 2.5% moves LEV from 2060 to 2045.</li>
                                <li><strong>Adoption S-Curves (Medium Certainty):</strong> We assume adoption follows a standard sigmoid curve. If social contagion accelerates adoption (viral TikTok trends for longevity), the "Majority Lag" could collapse from 15 years to 5 years, significantly boosting mass survival.</li>
                            </ul>
                        </p>

                        <h4 style={{ color: 'white', marginTop: 16, marginBottom: 8 }}>8. The Health Index: Measuring Robustness</h4>
                        <p style={{ marginBottom: 12 }}>
                            The "Health Index" (0-100%) is an inverse measure of <strong>Deficit Accumulation</strong> (often called a Frailty Index).
                            <br />
                            <span style={{ opacity: 0.7 }}>100% = Perfect Robustness</span> | <span style={{ opacity: 0.7 }}>0% = Systemic Failure (Death)</span>
                            <br />
                            Unlike the binary "Alive/Dead" metric, this index tracks the accumulation of sub-clinical damage (senescent cells, stiffening arteries, DNA breaks). A LEV protocol doesn't just aim to keep you "Alive"; it aims to keep your Health Index above 80% (the "Functional Threshold"). If this Index drops below 40%, survival probability plummets regardless of Chronological Age.
                        </p>

                        <h4 style={{ color: 'white', marginTop: 16, marginBottom: 8 }}>9. Medical Progress & The Cone of Uncertainty</h4>
                        <p style={{ marginBottom: 12 }}>
                            What does the <strong>Green Cone</strong> actually represent?
                            <br />
                            It represents the variance in <strong>Scientific Discovery</strong>, governed by a Poisson process of breakthroughs.
                            <br />
                            <strong>Key Accelerants (Move to Top of Cone):</strong>
                            <ul style={{ paddingLeft: 16, marginTop: 4 }}>
                                <li><strong>Recursive Self-Improving AI:</strong> Increasing overall intelligence to solve biological complexity.</li>
                                <li><strong>Virtual Cell Simulations:</strong> Accurate in-silico models grounded to reality, reducing trial-and-error.</li>
                                <li><strong>Automated Wetlabs:</strong> Robotically validating science at scale, closing the loop with AI.</li>
                                <li><strong>Capital Inflows:</strong> Massive government & public investment to reduce the medical cost burden of aging populations.</li>
                            </ul>
                            <strong>Key Stalls (Move to Bottom of Cone):</strong>
                            <ul style={{ paddingLeft: 16, marginTop: 4 }}>
                                <li><strong>Geopolitical Conflict:</strong> Global chaos diverting resources away from long-term science.</li>
                                <li><strong>Misaligned AI:</strong> Powerful systems hijacked by chaos agents or used for destruction rather than progress.</li>
                                <li><strong>Economic Stagnation:</strong> Systemic collapse limiting the funding required for expensive R&D.</li>
                            </ul>
                            Use the <strong>Optimism Slider</strong> to bias this probability distribution.
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
}
