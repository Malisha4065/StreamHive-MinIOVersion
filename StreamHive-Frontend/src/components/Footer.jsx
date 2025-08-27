import React from "react";

export default function Footer() {
  const year = new Date().getFullYear();
  return (
    <footer className="mt-12 text-sm text-slate-400">
      <div className="hr-glow mb-6" />
      <div className="grid gap-6 md:grid-cols-3">
        <div>
          <div className="text-slate-200 font-semibold">StreamHive</div>
          <p className="mt-2 text-slate-400/80">
            The best streaming app Developed by AICGR Group.
          </p>
        </div>
        <div>
          <div className="uppercase tracking-wide text-xs text-slate-400">Navigation</div>
          <ul className="mt-2 space-y-1">
            <li><a className="hover:text-white" href="#">Home</a></li>
            <li><a className="hover:text-white" href="#">Uploads</a></li>
            <li><a className="hover:text-white" href="#">Library</a></li>
          </ul>
        </div>
        <div>
          <div className="uppercase tracking-wide text-xs text-slate-400">Community</div>
          <div className="mt-2 flex gap-3">
            <a className="btn-ghost px-3 py-2" href="#" aria-label="GitHub">GitHub</a>
            <a className="btn-ghost px-3 py-2" href="#" aria-label="Docs">Docs</a>
          </div>
        </div>
      </div>
      <div className="mt-6 text-xs text-slate-500">© {year} StreamHive</div>
    </footer>
  );
}
