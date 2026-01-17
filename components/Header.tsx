
import React from 'react';

const Header: React.FC = () => {
  return (
    <header className="border-b border-slate-700 bg-slate-900/50 backdrop-blur-md sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-indigo-600 rounded-lg flex items-center justify-center shadow-lg shadow-indigo-500/20">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-white"><path d="m16 4 3 3L7 19H4v-3L16 4z"/><path d="m14 6 3 3"/><path d="M11 7 8 4"/><path d="m18 12-3-3"/></svg>
          </div>
          <div>
            <h1 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-indigo-400 to-blue-400">
              POCT Document Translator
            </h1>
            <p className="text-xs text-slate-400 font-medium tracking-tight">AI-Powered 1:1 Medical Data Translation</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
            Kernel Ready
          </span>
        </div>
      </div>
    </header>
  );
};

export default Header;
