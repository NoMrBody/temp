"use client";

import { useEffect, useRef } from "react";
import { mountBoard } from "../lib/board/mount";

export default function Board() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    return mountBoard(ref.current);
  }, []);

  return (
    <div ref={ref} style={{ display: "contents" }}>
      <canvas id="sheets"></canvas>
      <canvas id="notes"></canvas>
      <canvas id="board"></canvas>
      <canvas id="glow"></canvas>
      <div id="marks"></div>
      <div id="notectl"></div>
      <div id="sheetctl"></div>

      <div className="toolbar" role="toolbar">
        <div className="seg" title="When should the tutor check your work?">
          <button id="modeAuto" className="active" title="Auto: checks as you write">Auto</button>
          <button id="modeManual" title="Manual: checks only when you press Check">Manual</button>
        </div>
        <button id="checkBtn" title="Check now (Enter)" hidden>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
          <b id="checkLabel" style={{ fontWeight: 600 }}>Check</b>
        </button>
        <div className="sep"></div>
        <button id="penBtn" className="active" title="Pen (P)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
          <span>Pen</span>
        </button>
        <button id="eraserBtn" title="Eraser (E)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m7 21-4.3-4.3a1 1 0 0 1 0-1.4l10-10a1 1 0 0 1 1.4 0l5.6 5.6a1 1 0 0 1 0 1.4L11 21" /><path d="M22 21H7" /><path d="m5 11 9 9" /></svg>
          <span>Eraser</span>
        </button>
        <button id="handBtn" title="Move around (H) — or hold Space, or use two fingers">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 11V6a2 2 0 0 0-4 0v1" /><path d="M14 10V4a2 2 0 0 0-4 0v6" /><path d="M10 10.5V6a2 2 0 0 0-4 0v8" /><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.9-5.9-2.4L3.4 16a2 2 0 0 1 3.2-2.4L8 15" /></svg>
          <span>Move</span>
        </button>
        <div className="popwrap">
          <button id="sizeBtn" title="Pen size">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round"><path d="M4 6h16" strokeWidth="1.5" /><path d="M4 12h16" strokeWidth="2.5" /><path d="M4 18h16" strokeWidth="4" /></svg>
          </button>
          <div className="pop" id="sizePop">
            Pen size
            <input id="penSize" type="range" min="1.5" max="6" step="0.1" />
            <div className="prev"><i id="sizePrev"></i></div>
          </div>
        </div>
        <div className="sep"></div>
        <button id="undoBtn" title="Undo (Ctrl+Z)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7v6h6" /><path d="M21 17a9 9 0 0 0-15-6.7L3 13" /></svg>
          <span>Undo</span>
        </button>
        <button id="clearBtn" title="Clear canvas">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
          <span>Clear Canvas</span>
        </button>
        <div className="sep"></div>
        <button id="traceBtn" title="Agent trace (T)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2" /></svg>
        </button>
        <button id="chatBtn" title="Tutor chat (C)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z" /></svg>
        </button>
        <button id="themeBtn" title="Switch to light mode">
          <svg id="themeSun" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="4" /><path d="M12 2v2" /><path d="M12 20v2" /><path d="m4.93 4.93 1.41 1.41" /><path d="m17.66 17.66 1.41 1.41" /><path d="M2 12h2" /><path d="M20 12h2" /><path d="m6.34 17.66-1.41 1.41" /><path d="m19.07 4.93-1.41 1.41" /></svg>
          <svg id="themeMoon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: "none" }}><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" /></svg>
        </button>
        <button id="voiceBtn" className="active" title="Voice on (M)">
          <svg id="voiceOnIcon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 5 6 9H2v6h4l5 4V5Z" /><path d="M15.5 8.5a5 5 0 0 1 0 7" /><path d="M19 5a10 10 0 0 1 0 14" /></svg>
          <svg id="voiceOffIcon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: "none" }}><path d="M11 5 6 9H2v6h4l5 4V5Z" /><path d="m22 9-6 6" /><path d="m16 9 6 6" /></svg>
        </button>
        <button id="accessBtn" title="Access code" hidden>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="7.5" cy="15.5" r="5.5" /><path d="m21 2-9.6 9.6" /><path d="m15.5 7.5 3 3L22 7l-3-3" /></svg>
        </button>
      </div>

      <div className="hintbox" id="hintbox" role="status" aria-live="polite">
        <div className="hb-head"><b>💡 Hint</b><button id="hintClose" aria-label="Close hint">×</button></div>
        <p id="hintBoxText"></p>
      </div>

      <div className="chat" id="chat">
        <div className="th-head"><b>Tutor chat</b><span></span><button id="chatClose" aria-label="Close chat">×</button></div>
        <div className="chat-pdf" id="chatPdf" hidden>
          <span>📄</span><span id="chatPdfName"></span><button id="chatPdfRemove" aria-label="Remove PDF">×</button>
        </div>
        <div className="chat-list" id="chatList"></div>
        <div className="chat-foot">
          <button id="chatAttach" title="Attach a PDF with problems" aria-label="Attach PDF">📎</button>
          <input id="chatFile" type="file" accept="application/pdf" hidden />
          <textarea id="chatInput" rows={2} placeholder="Ask about a problem… (Enter to send)"></textarea>
          <button id="chatSend" className="primary">Send</button>
        </div>
      </div>

      <div className="pages" role="group" aria-label="Pages">
        <button id="pagePrev" title="Previous page" aria-label="Previous page">‹</button>
        <span id="pageLabel">Page 1 / 1</span>
        <button id="pageNext" title="Next page" aria-label="Next page">›</button>
        <button id="pageAdd" title="Add a page" aria-label="Add a page">+</button>
        <span className="psep"></span>
        <button id="zoomOut" title="Zoom out" aria-label="Zoom out">−</button>
        <button id="zoomLabel" title="Back to 100%">100%</button>
        <button id="zoomIn" title="Zoom in" aria-label="Zoom in">+</button>
        <button id="zoomFit" title="Fit the worksheet to the screen (0)" aria-label="Fit to screen">⤢</button>
        <span className="psep"></span>
        <button id="openPdf" title="Open a PDF with problems">📄 Open PDF</button>
        <button id="exportPdf" title="Export all pages as PDF" aria-label="Export PDF">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M5 21h14" /></svg>
          PDF
        </button>
      </div>

      <div className="hint" id="hint">
        <h1 id="hintTitle">Write your math. Your buddy is watching.</h1>
        <p id="hintText">A green tick means a line checks out. If something&apos;s off, he&apos;ll light it up and tell you. Press M to mute.</p>
      </div>

      <div className="status idle" id="status"><span className="dot"></span><span id="statusText">Ready</span></div>

      <div className="card" id="card" data-kind="bad" aria-live="polite">
        <span className="bar"></span>
        <p className="text" id="cardText"></p>
        <button className="close" id="cardClose" aria-label="Dismiss">×</button>
      </div>

      <div className="graph" id="graph">
        <div className="g-head"><div className="g-series" id="gSeries"></div><button id="gClose" aria-label="Close graph">×</button></div>
        <div className="g-tools">
          <button data-z="x+" title="Zoom in on x">x+</button><button data-z="x-" title="Zoom out on x">x−</button>
          <button data-z="y+" title="Zoom in on y">y+</button><button data-z="y-" title="Zoom out on y">y−</button>
          <button id="gReset">Reset</button>
        </div>
        <canvas id="gcanvas"></canvas>
        <div className="g-read" id="gRead">drag to pan · scroll to zoom</div>
      </div>

      <div className="trace" id="trace">
        <div className="th-head"><b>Agent trace</b><span id="traceStats"></span><button id="traceClose" aria-label="Close">×</button></div>
        <div className="tlist" id="traceList"></div>
        <div className="tfoot"><button id="traceExport">Export JSON</button><button id="traceClear">Clear</button></div>
      </div>

      <div className="modal" id="accessModal">
        <div className="box">
          <h2>Access code</h2>
          <p>This server is protected. Enter the access code.</p>
          <input id="accessInput" type="password" placeholder="Access code" autoComplete="off" spellCheck={false} />
          <div className="row">
            <button id="accessCancel">Cancel</button>
            <button id="accessSave" className="primary">Save</button>
          </div>
        </div>
      </div>
    </div>
  );
}
