
import React, { useEffect, useRef, useState } from 'react';

type ThemeMode = 'light' | 'dark';

interface HeaderProps {
  theme: ThemeMode;
  onThemeToggle: () => void;
  activeView?: 'translator' | 'modelReview';
  onNavigate?: (view: 'translator' | 'modelReview') => void;
  version?: string;
  authStatus?: 'checking' | 'authenticated' | 'anonymous' | 'blocked';
  userEmail?: string;
}

const Header: React.FC<HeaderProps> = ({
  theme,
  onThemeToggle,
  activeView = 'translator',
  onNavigate,
  version,
  authStatus = 'anonymous',
  userEmail
}) => {
  const [isGuideOpen, setIsGuideOpen] = useState(false);
  const guideRef = useRef<HTMLDivElement>(null);
  const isLight = theme === 'light';
  const authLabel =
    authStatus === 'checking'
      ? 'Checking'
      : authStatus === 'blocked'
        ? 'Blocked'
        : authStatus === 'authenticated'
          ? userEmail || 'Signed in'
          : 'Guest';

  useEffect(() => {
    if (!isGuideOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!guideRef.current?.contains(event.target as Node)) {
        setIsGuideOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsGuideOpen(false);
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isGuideOpen]);

  return (
    <header className={`sticky top-0 z-50 border-b backdrop-blur-md ${
      isLight
        ? 'border-slate-200/80 bg-white/90 shadow-[0_10px_34px_rgba(15,23,42,0.08)]'
        : 'border-slate-800 bg-slate-950/85 shadow-[0_10px_34px_rgba(0,0,0,0.22)]'
    }`}>
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className={`absolute inset-0 ${
          isLight
            ? 'bg-[radial-gradient(circle_at_88%_-45%,rgba(99,102,241,0.22)_0,rgba(99,102,241,0.10)_30%,transparent_58%),linear-gradient(135deg,rgba(255,255,255,0)_0%,rgba(248,250,252,0.65)_52%,rgba(238,242,255,0.92)_100%)]'
            : 'bg-[radial-gradient(circle_at_88%_-40%,rgba(79,70,229,0.38)_0,rgba(37,99,235,0.14)_34%,transparent_62%),linear-gradient(135deg,rgba(2,6,23,0.96)_0%,rgba(15,23,42,0.92)_56%,rgba(30,41,59,0.86)_100%)]'
        }`}></div>
        <div className={`absolute -right-24 -top-20 h-44 w-[560px] rotate-[-18deg] border-l ${
          isLight
            ? 'border-indigo-100/90 bg-gradient-to-r from-transparent via-indigo-50/80 to-blue-100/70'
            : 'border-indigo-400/10 bg-gradient-to-r from-transparent via-indigo-500/10 to-cyan-400/10'
        }`}></div>
        <div className={`absolute right-24 top-0 h-24 w-px rotate-[46deg] ${
          isLight ? 'bg-indigo-100/90' : 'bg-indigo-300/10'
        }`}></div>
      </div>
      <div className="relative z-10 max-w-7xl mx-auto px-4 h-[72px] flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-br from-indigo-500 to-blue-600 rounded-2xl flex items-center justify-center shadow-[0_12px_30px_rgba(79,70,229,0.25)] ring-1 ring-white/20">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-white"><path d="M4 19.5V5a2 2 0 0 1 2-2h9l5 5v11.5a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 19.5z"/><path d="M14 3v5h5"/><path d="M8 13h8"/><path d="M8 17h5"/><path d="M8 9h2"/></svg>
          </div>
          <div className="flex flex-col justify-center leading-none">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className={`text-xl font-bold ${
                isLight
                  ? 'text-slate-950'
                  : 'bg-clip-text text-transparent bg-gradient-to-r from-indigo-400 to-blue-400'
              }`}>
                POCT Document Translator
              </h1>
              {version && (
                <span className={`rounded-full border px-2 py-0.5 text-[11px] font-bold leading-4 ${
                  isLight
                    ? 'border-indigo-200 bg-indigo-50 text-indigo-700'
                    : 'border-indigo-400/30 bg-indigo-400/10 text-indigo-200'
                }`}>
                  v{version}
                </span>
              )}
            </div>
            <p className={`mt-1.5 text-xs font-medium tracking-tight ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>AI-Powered 1:1 Medical Data Translation</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className={`flex items-center gap-1 rounded-full border p-1 ${
            isLight ? 'border-slate-200 bg-white/75 shadow-sm' : 'border-white/[0.08] bg-white/[0.05]'
          }`}>
            <button
              type="button"
              onClick={() => onNavigate?.('translator')}
              className={`rounded-full px-2.5 sm:px-3 py-1.5 text-xs font-semibold transition-all ${
                activeView === 'translator'
                  ? isLight
                    ? 'bg-slate-900 text-white'
                    : 'bg-white text-slate-950'
                  : isLight
                    ? 'text-slate-600 hover:text-slate-950'
                    : 'text-slate-400 hover:text-slate-100'
              }`}
            >
              <span className="hidden sm:inline">Translator</span>
              <span className="sm:hidden">Translate</span>
            </button>
            <button
              type="button"
              onClick={() => onNavigate?.('modelReview')}
              className={`rounded-full px-2.5 sm:px-3 py-1.5 text-xs font-semibold transition-all ${
                activeView === 'modelReview'
                  ? isLight
                    ? 'bg-indigo-600 text-white'
                    : 'bg-indigo-400 text-slate-950'
                  : isLight
                    ? 'text-slate-600 hover:text-indigo-700'
                    : 'text-slate-400 hover:text-slate-100'
              }`}
            >
              <span className="hidden sm:inline">Multi-AI Review Lab</span>
              <span className="sm:hidden">Review</span>
            </button>
          </div>
          <div
            className={`hidden lg:inline-flex max-w-[220px] items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold ${
              authStatus === 'blocked'
                ? isLight
                  ? 'border-rose-200 bg-rose-50 text-rose-700'
                  : 'border-rose-400/25 bg-rose-500/10 text-rose-200'
                : isLight
                  ? 'border-slate-200 bg-white/75 text-slate-600'
                  : 'border-white/[0.08] bg-white/[0.05] text-slate-300'
            }`}
            title={userEmail || authLabel}
          >
            <span
              className={`h-2 w-2 shrink-0 rounded-full ${
                authStatus === 'authenticated'
                  ? 'bg-emerald-500'
                  : authStatus === 'blocked'
                    ? 'bg-rose-500'
                    : authStatus === 'checking'
                      ? 'bg-amber-400'
                      : 'bg-slate-400'
              }`}
            ></span>
            <span className="truncate">{authLabel}</span>
          </div>
          <div className="relative" ref={guideRef}>
            <button
              type="button"
              onClick={() => setIsGuideOpen((open) => !open)}
              className={`cursor-pointer list-none inline-flex items-center px-3 py-1.5 rounded-full text-xs font-semibold border transition-all ${
                isLight
                  ? 'bg-white/80 text-slate-700 border-white/80 shadow-sm hover:border-indigo-300 hover:text-indigo-700'
                  : 'bg-white/[0.06] text-slate-300 border-white/[0.08] hover:border-indigo-500/40 hover:text-slate-100'
              }`}
            >
              操作说明
            </button>
            {isGuideOpen && (
            <div className={`absolute right-0 mt-3 w-[min(460px,calc(100vw-2rem))] max-h-[calc(100vh-96px)] overflow-y-auto overscroll-contain rounded-xl border p-4 shadow-2xl ${
              isLight ? 'border-slate-200 bg-white text-slate-700' : 'border-slate-700 bg-slate-950 text-slate-400'
            }`}>
              <div className={`space-y-4 text-xs ${isLight ? 'text-slate-600' : 'text-slate-400'}`}>
                <section>
                  <h3 className={`mb-2 text-[11px] font-semibold uppercase tracking-wider ${isLight ? 'text-slate-900' : 'text-slate-300'}`}>基础设置</h3>
                  <ol className="space-y-2 list-decimal list-inside">
                    <li>上传 Excel 或 DOCX 文件。</li>
                    <li>选择目标语言，支持英、法、西、德、意、土、俄、葡等 8 国语言翻译。</li>
                    <li>Full Translation 会重写所有行，适合首次完整翻译或需要全部刷新译文时使用。</li>
                    <li>Smart Fill 只处理疑似未翻译或非目标语言内容，适合补译、续翻和节省模型调用。</li>
                    <li>Translation Model 选择 Auto 时会按 Gemini → Qwen → DeepSeek 顺序自动切换；手动选择模型时只使用所选模型。</li>
                    <li>Protected Terms 用于保护品牌名、公司名、型号、专有术语等不被翻译；一行一个词，保存后会在本机自动记住。</li>
                  </ol>
                </section>
                <section>
                  <h3 className={`mb-2 text-[11px] font-semibold uppercase tracking-wider ${isLight ? 'text-slate-900' : 'text-slate-300'}`}>翻译运行</h3>
                  <ol className="space-y-2 list-decimal list-inside">
                    <li>点击 Run Global Translation 开始翻译。</li>
                    <li>翻译中可点击 Pause 暂停，并下载查看翻译质量；暂停后可点击 Resume 继续。</li>
                    <li>如检测到漏翻，可使用 Retry Missing Cells 只补译问题行。</li>
                  </ol>
                </section>
                <section>
                  <h3 className={`mb-2 text-[11px] font-semibold uppercase tracking-wider ${isLight ? 'text-slate-900' : 'text-slate-300'}`}>质检修复</h3>
                  <ol className="space-y-2 list-decimal list-inside">
                    <li>导出前建议运行 Run Quality Check，并在 Quality Report 查看摘要和问题详情。</li>
                    <li>Excel 文件可使用 Apply Cleanup 自动修复常见空格、格式和术语清理问题。</li>
                    <li>Excel 文件可使用 Retry Placeholder Cells 重译占位符异常单元格，例如坏 token 或残留占位符。</li>
                  </ol>
                </section>
                <section>
                  <h3 className={`mb-2 text-[11px] font-semibold uppercase tracking-wider ${isLight ? 'text-slate-900' : 'text-slate-300'}`}>抽样审查</h3>
                  <ol className="space-y-2 list-decimal list-inside">
                    <li>Start Sample Review 会生成抽样检查池。</li>
                    <li>Run AI Review 会对抽样内容做只读 AI 审查，不会自动改写译文。</li>
                    <li>Start Sample Review 和 Run AI Review 需要先完成翻译并运行 Quality Check 后才可用。</li>
                  </ol>
                </section>
              </div>
            </div>
            )}
          </div>
          <button
            type="button"
            onClick={onThemeToggle}
            className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold transition-all ${
              isLight
                ? 'border-indigo-200/80 bg-indigo-50/90 text-indigo-700 hover:bg-indigo-100'
                : 'border-white/[0.08] bg-white/[0.06] text-slate-300 hover:border-indigo-500/40 hover:text-slate-100'
            }`}
            aria-label="Toggle color theme"
          >
            <span className={`h-2 w-2 rounded-full ${isLight ? 'bg-indigo-500' : 'bg-slate-400'}`}></span>
            {isLight ? 'Light' : 'Dark'}
          </button>
        </div>
      </div>
    </header>
  );
};

export default Header;
