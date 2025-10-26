import React, { useState, useRef } from "react";
import { Bar } from "react-chartjs-2";
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend } from "chart.js";

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend);

const parseRefs = (s) =>
  s
    .split(/[,\s]+/)
    .map((x) => x.trim())
    .filter((x) => x !== "")
    .map(Number);

function simulateFIFO(refs, framesCount) {
  const frames = Array(framesCount).fill(null);
  const queue = [];
  const snapshots = [];
  let faults = 0;
  refs.forEach((page, step) => {
    const hitIndex = frames.indexOf(page);
    if (hitIndex !== -1) {
      snapshots.push({ step, page, frames: [...frames], fault: false, evicted: null });
      return;
    }
    faults++;
    const emptyIndex = frames.indexOf(null);
    if (emptyIndex !== -1) {
      frames[emptyIndex] = page;
      queue.push(emptyIndex);
      snapshots.push({ step, page, frames: [...frames], fault: true, evicted: null });
    } else {
      const victim = queue.shift();
      const evicted = frames[victim];
      frames[victim] = page;
      queue.push(victim);
      snapshots.push({ step, page, frames: [...frames], fault: true, evicted });
    }
  });
  return { faults, snapshots };
}

function simulateLRU(refs, framesCount) {
  const frames = Array(framesCount).fill(null);
  const lastUsed = new Map();
  const snapshots = [];
  let faults = 0;

  refs.forEach((page, step) => {
    const hitIndex = frames.indexOf(page);
    if (hitIndex !== -1) {
      lastUsed.set(page, step);
      snapshots.push({ step, page, frames: [...frames], fault: false, evicted: null });
      return;
    }
    faults++;
    const emptyIndex = frames.indexOf(null);
    if (emptyIndex !== -1) {
      frames[emptyIndex] = page;
      lastUsed.set(page, step);
      snapshots.push({ step, page, frames: [...frames], fault: true, evicted: null });
    } else {
      let victimIndex = 0;
      let victimPage = frames[0];
      let minTime = lastUsed.get(victimPage) ?? -1;
      for (let i = 0; i < frames.length; i++) {
        const p = frames[i];
        const t = lastUsed.get(p) ?? -1;
        if (t < minTime) {
          minTime = t;
          victimIndex = i;
          victimPage = p;
        }
      }
      const evicted = frames[victimIndex];
      lastUsed.delete(evicted);
      frames[victimIndex] = page;
      lastUsed.set(page, step);
      snapshots.push({ step, page, frames: [...frames], fault: true, evicted });
    }
  });
  return { faults, snapshots };
}

function simulateOptimal(refs, framesCount) {
  const frames = Array(framesCount).fill(null);
  const snapshots = [];
  let faults = 0;
  refs.forEach((page, step) => {
    const hitIndex = frames.indexOf(page);
    if (hitIndex !== -1) {
      snapshots.push({ step, page, frames: [...frames], fault: false, evicted: null });
      return;
    }
    faults++;
    const emptyIndex = frames.indexOf(null);
    if (emptyIndex !== -1) {
      frames[emptyIndex] = page;
      snapshots.push({ step, page, frames: [...frames], fault: true, evicted: null });
    } else {
      const nextUse = frames.map((p) => {
        const idx = refs.slice(step + 1).indexOf(p);
        return idx === -1 ? Infinity : idx;
      });
      let victimIndex = 0;
      let maxNext = -1;
      for (let i = 0; i < nextUse.length; i++) {
        const nu = nextUse[i] === Infinity ? Infinity : nextUse[i];
        if (nu === Infinity) {
          victimIndex = i;
          break;
        }
        if (nu > maxNext) {
          maxNext = nu;
          victimIndex = i;
        }
      }
      const evicted = frames[victimIndex];
      frames[victimIndex] = page;
      snapshots.push({ step, page, frames: [...frames], fault: true, evicted });
    }
  });
  return { faults, snapshots };
}

function copySnapshots(snapshots) {
  return snapshots.map((s) => ({ ...s, frames: [...s.frames] }));
}

export default function App() {
  const [framesCount, setFramesCount] = useState(3);
  const [refString, setRefString] = useState("7,0,1,2,0,3,0,4,2,3,0,3");
  const [algorithm, setAlgorithm] = useState("FIFO");
  const [snapshots, setSnapshots] = useState([]);
  const [currentStep, setCurrentStep] = useState(0);
  const [faults, setFaults] = useState(0);
  const [running, setRunning] = useState(false);
  const [autoInterval, setAutoInterval] = useState(700);
  const timerRef = useRef(null);
  const [compareResults, setCompareResults] = useState(null);

  const hitsCount = snapshots.slice(0, currentStep).filter((s) => !s.fault).length;
  const missesCount = snapshots.slice(0, currentStep).filter((s) => s.fault).length;
  const totalCount = hitsCount + missesCount;
  const hitRatio = totalCount ? ((hitsCount / totalCount) * 100).toFixed(2) : 0;
  const missRatio = totalCount ? ((missesCount / totalCount) * 100).toFixed(2) : 0;

  const hitMissChartData = {
    labels: ["Hits", "Misses"],
    datasets: [
      {
        label: "Paging Performance (%)",
        data: [hitRatio, missRatio],
        backgroundColor: ["#4CAF50", "#F44336"],
        borderColor: ["#388E3C", "#D32F2F"],
        borderWidth: 1,
      },
    ],
  };

  const hitMissChartOptions = {
    responsive: true,
    plugins: { legend: { display: false }, title: { display: true, text: "Hit vs Miss Ratio" } },
    scales: { y: { beginAtZero: true, max: 100, title: { display: true, text: "Percentage (%)" } } },
  };

  const runOnce = (alg, refs, fcount) => {
    if (alg === "FIFO") return simulateFIFO(refs, fcount);
    if (alg === "LRU") return simulateLRU(refs, fcount);
    if (alg === "Optimal") return simulateOptimal(refs, fcount);
    return simulateFIFO(refs, fcount);
  };

  const prepareSimulation = () => {
    const refs = parseRefs(refString);
    if (refs.length === 0 || isNaN(framesCount) || framesCount <= 0) {
      alert("Invalid input.");
      return false;
    }
    const result = runOnce(algorithm, refs, Number(framesCount));
    setSnapshots(copySnapshots(result.snapshots));
    setFaults(result.faults);
    setCurrentStep(0);
    setCompareResults(null);
    return true;
  };

  const stepForward = () => setCurrentStep((s) => Math.min(s + 1, snapshots.length));
  const stepBackward = () => setCurrentStep((s) => Math.max(s - 1, 0));

  const runAuto = () => {
    if (running) return;
    setRunning(true);
    timerRef.current = setInterval(() => {
      setCurrentStep((s) => {
        if (s >= snapshots.length) {
          clearInterval(timerRef.current);
          setRunning(false);
          return s;
        }
        return s + 1;
      });
    }, autoInterval);
  };

  const stopAuto = () => {
    setRunning(false);
    if (timerRef.current) clearInterval(timerRef.current);
  };

  const resetSim = () => {
    stopAuto();
    setSnapshots([]);
    setCurrentStep(0);
    setFaults(0);
    setCompareResults(null);
  };

  const exportResults = () => {
    const payload = { framesCount, refString, algorithm, faults, snapshots };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "paging_simulation_result.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  // --- Updated runComparison ---
  const runComparison = () => {
    const refs = parseRefs(refString);
    if (refs.length === 0 || isNaN(framesCount) || framesCount <= 0) return;

    const fifo = simulateFIFO(refs, Number(framesCount));
    const lru = simulateLRU(refs, Number(framesCount));
    const optimal = simulateOptimal(refs, Number(framesCount));

    const fifoHits = refs.length - fifo.faults;
    const lruHits = refs.length - lru.faults;
    const optimalHits = refs.length - optimal.faults;

    const fifoHitRatio = ((fifoHits / refs.length) * 100).toFixed(2);
    const lruHitRatio = ((lruHits / refs.length) * 100).toFixed(2);
    const optimalHitRatio = ((optimalHits / refs.length) * 100).toFixed(2);

    setCompareResults({
      FIFO: { hitRatio: fifoHitRatio, faults: fifo.faults },
      LRU: { hitRatio: lruHitRatio, faults: lru.faults },
      Optimal: { hitRatio: optimalHitRatio, faults: optimal.faults },
    });

    const chosen = algorithm === "FIFO" ? fifo : algorithm === "LRU" ? lru : optimal;
    setSnapshots(copySnapshots(chosen.snapshots));
    setFaults(chosen.faults);
    setCurrentStep(0);
  };

  // --- Styled containers ---
  const containerStyle = {
    maxWidth: "1000px",
    margin: "0 auto",
    fontFamily: "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif",
    padding: 20,
    color: "#333",
  };

  const panelStyle = {
    display: "flex",
    flexWrap: "wrap",
    gap: "10px",
    marginBottom: 20,
    alignItems: "center",
  };

  const inputStyle = { padding: "6px 10px", fontSize: 14, borderRadius: 4, border: "1px solid #ccc" };

  const btnStyle = {
    padding: "8px 14px",
    fontSize: 14,
    border: "none",
    borderRadius: 4,
    cursor: "pointer",
    backgroundColor: "#2196F3",
    color: "#fff",
    transition: "0.3s",
  };

  const tableStyle = {
    borderCollapse: "collapse",
    width: "100%",
    marginTop: 16,
  };

  const thTdStyle = { border: "1px solid #999", padding: 6, textAlign: "center" };

  return (
    <div style={containerStyle}>
      <h2 style={{ textAlign: "center", marginBottom: 20 }}>🖥️ Paging Simulator</h2>

      <div style={panelStyle}>
        <label>Frames:</label>
        <input type="number" value={framesCount} onChange={(e) => setFramesCount(Number(e.target.value))} style={inputStyle} />
        <label> Reference string:</label>
        <input type="text" value={refString} onChange={(e) => setRefString(e.target.value)} style={{ ...inputStyle, minWidth: 300 }} />
        <label>Algorithm:</label>
        <select value={algorithm} onChange={(e) => setAlgorithm(e.target.value)} style={inputStyle}>
          <option>FIFO</option>
          <option>LRU</option>
          <option>Optimal</option>
        </select>
        <button onClick={prepareSimulation} style={btnStyle}>Prepare</button>
        <button onClick={runComparison} style={{ ...btnStyle, backgroundColor: "#4CAF50" }}>Compare</button>
      </div>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button onClick={stepBackward} style={btnStyle}>⏮ Prev</button>
        <button onClick={stepForward} style={btnStyle}>Next ⏭</button>
        <button onClick={runAuto} disabled={running} style={btnStyle}>▶️ Run</button>
        <button onClick={stopAuto} style={{ ...btnStyle, backgroundColor: "#f44336" }}>⏹ Stop</button>
        <button onClick={resetSim} style={{ ...btnStyle, backgroundColor: "#FF9800" }}>🔄 Reset</button>
        <button onClick={exportResults} style={{ ...btnStyle, backgroundColor: "#9C27B0" }}>💾 Export JSON</button>
      </div>

      <div style={{ maxWidth: 500, marginTop: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8, fontWeight: "bold" }}>
          <span>Hit Ratio: {hitRatio}% ✅</span>
          <span>Miss Ratio: {missRatio}% ❌</span>
        </div>
        <Bar data={hitMissChartData} options={hitMissChartOptions} />
      </div>

      <div style={{ marginTop: 20 }}>
        <strong>Step {currentStep} / {snapshots.length}</strong>
        <div style={{ marginTop: 8 }}>Page Faults: {faults}</div>

        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thTdStyle}>#</th>
              <th style={thTdStyle}>Req</th>
              {[...Array(framesCount)].map((_, i) => <th key={i} style={thTdStyle}>F{i}</th>)}
              <th style={thTdStyle}>Fault</th>
            </tr>
          </thead>
          <tbody>
            {snapshots.slice(0, currentStep).map((s, i) => (
              <tr key={i} style={{ backgroundColor: s.fault ? "#FFEBEE" : "#E8F5E9" }}>
                <td style={thTdStyle}>{i + 1}</td>
                <td style={thTdStyle}>{s.page}</td>
                {s.frames.map((p, j) => <td key={j} style={thTdStyle}>{p === null ? "-" : p}</td>)}
                <td style={thTdStyle}>{s.fault ? "Yes" : "No"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* --- Hit Ratio Comparison --- */}
      {compareResults && (
        <div style={{ marginTop: 20, padding: 10, backgroundColor: "#f5f5f5", borderRadius: 6 }}>
          <h3>📊 Algorithm Hit Ratios</h3>

          <div style={{ display: "flex", justifyContent: "space-around", marginBottom: 12 }}>
            {Object.entries(compareResults).map(([alg, stats]) => {
              const maxHit = Math.max(...Object.values(compareResults).map((a) => Number(a.hitRatio)));
              const isBest = Number(stats.hitRatio) === maxHit;
              return (
                <div key={alg} style={{
                  textAlign: "center",
                  flex: 1,
                  margin: "0 6px",
                  padding: 8,
                  borderRadius: 6,
                  background: isBest ? "#d4edda" : "#f8f9fa",
                  border: isBest ? "2px solid #28a745" : "1px solid #ccc"
                }}>
                  <strong>{alg}</strong>
                  <div style={{ fontSize: 14 }}>Faults: {stats.faults}</div>
                                    <div style={{ fontSize: 14 }}>Hit Ratio: {stats.hitRatio}%</div>
                  {isBest && <div style={{ color: "#28a745", fontWeight: "bold" }}>✅ Best</div>}
                </div>
              );
            })}
          </div>

          {/* Optional: Bar chart for comparison */}
          <Bar
            data={{
              labels: Object.keys(compareResults),
              datasets: [
                {
                  label: "Hit Ratio (%)",
                  data: Object.values(compareResults).map((s) => Number(s.hitRatio)),
                  backgroundColor: ["#2196F3", "#FF9800", "#4CAF50"],
                  borderColor: ["#1976D2", "#FB8C00", "#388E3C"],
                  borderWidth: 1,
                },
              ],
            }}
            options={{
              responsive: true,
              plugins: {
                legend: { display: false },
                title: { display: true, text: "Algorithm Hit Ratio Comparison" },
              },
              scales: {
                y: { beginAtZero: true, max: 100, title: { display: true, text: "Hit Ratio (%)" } },
              },
            }}
          />
        </div>
      )}
    </div>
  );
}

