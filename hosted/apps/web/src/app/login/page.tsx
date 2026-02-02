"use client";

import { createClient } from "@/lib/supabase/client";
import { useState } from "react";

export default function LoginPage() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const supabase = createClient();

  const handleGoogleLogin = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${window.location.origin}/auth/callback`,
        },
      });

      if (error) {
        setError(error.message);
      }
    } catch {
      setError("An unexpected error occurred");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex">
      {/* Left side - Branding with gradient */}
      <div className="hidden lg:flex lg:w-1/2 relative overflow-hidden">
        {/* Soft gradient background - muted indigo to purple */}
        <div className="absolute inset-0 bg-gradient-to-br from-[#818CF8] via-[#A78BFA] to-[#C4B5FD]" />

        {/* Decorative elements */}
        <div className="absolute top-20 left-20 w-72 h-72 bg-white/20 rounded-full blur-3xl" />
        <div className="absolute bottom-20 right-20 w-96 h-96 bg-white/10 rounded-full blur-3xl" />
        <div className="absolute top-1/2 right-0 w-64 h-64 bg-indigo-200/20 rounded-full blur-3xl" />

        {/* Content */}
        <div className="relative z-10 flex flex-col justify-between p-12 w-full">
          {/* Logo */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/30 backdrop-blur-sm flex items-center justify-center">
              <svg
                className="w-6 h-6 text-white"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
                />
              </svg>
            </div>
            <span className="text-xl font-bold text-white">OpenClaw</span>
          </div>

          {/* Main content - centered */}
          <div className="flex-1 flex flex-col justify-center items-center text-center max-w-md mx-auto">
            <h1 className="text-5xl font-bold text-white mb-4 leading-tight">
              An AI assistant that actually helps
            </h1>
            <p className="text-xl text-white/70 leading-relaxed mb-10">
              Tell it what you need. It gets it done.
            </p>

            {/* Social proof */}
            <div className="flex items-center gap-3 text-white/60 text-sm">
              <div className="flex -space-x-2">
                <div className="w-8 h-8 rounded-full bg-white/20 border-2 border-white/10 flex items-center justify-center text-xs font-medium text-white">J</div>
                <div className="w-8 h-8 rounded-full bg-white/20 border-2 border-white/10 flex items-center justify-center text-xs font-medium text-white">M</div>
                <div className="w-8 h-8 rounded-full bg-white/20 border-2 border-white/10 flex items-center justify-center text-xs font-medium text-white">S</div>
                <div className="w-8 h-8 rounded-full bg-white/20 border-2 border-white/10 flex items-center justify-center text-xs font-medium text-white">A</div>
              </div>
              <span>Joined by 2,000+ people</span>
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center gap-2 text-sm text-white/50">
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/>
            </svg>
            <span>Powered by Claude AI</span>
          </div>
        </div>
      </div>

      {/* Right side - Login form (always light) */}
      <div className="flex-1 flex items-center justify-center p-8 bg-[#FAFAFA]">
        <div className="w-full max-w-sm">
          {/* Mobile logo */}
          <div className="lg:hidden flex items-center justify-center gap-3 mb-8">
            <div className="w-10 h-10 rounded-xl bg-[#8B5CF6] flex items-center justify-center">
              <svg
                className="w-6 h-6 text-white"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
                />
              </svg>
            </div>
            <span className="text-xl font-bold text-[#1a1a1a]">OpenClaw</span>
          </div>

          {/* Login content */}
          <div className="text-center mb-8">
            <h2 className="text-2xl font-bold text-[#1a1a1a] mb-2">Get started for free</h2>
            <p className="text-[#666]">No credit card required</p>
          </div>

          {/* Main CTA */}
          <button
            onClick={handleGoogleLogin}
            disabled={isLoading}
            className="w-full flex items-center justify-center gap-3 rounded-xl bg-[#1a1a1a] text-white px-4 py-4 text-base font-semibold hover:bg-[#333] transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg"
          >
            {isLoading ? (
              <>
                <div className="w-5 h-5 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                Signing in...
              </>
            ) : (
              <>
                <svg className="h-5 w-5" viewBox="0 0 24 24">
                  <path
                    fill="#4285F4"
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                  />
                  <path
                    fill="#EA4335"
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                  />
                </svg>
                Continue with Google
              </>
            )}
          </button>

          {/* Trust signals */}
          <div className="flex items-center justify-center gap-4 mt-6 text-sm text-[#888]">
            <div className="flex items-center gap-1.5">
              <svg className="w-4 h-4 text-[#22c55e]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
              </svg>
              <span>Secure</span>
            </div>
            <div className="w-1 h-1 rounded-full bg-[#ccc]" />
            <span>Takes 30 seconds</span>
          </div>

          {error && (
            <div className="mt-4 p-3 rounded-xl bg-red-50 border border-red-200">
              <p className="text-sm text-red-600 text-center">{error}</p>
            </div>
          )}

          {/* Terms */}
          <p className="mt-8 text-xs text-center text-[#999] leading-relaxed">
            By continuing, you agree to our{" "}
            <a href="#" className="underline hover:text-[#666]">
              Terms
            </a>{" "}
            and{" "}
            <a href="#" className="underline hover:text-[#666]">
              Privacy Policy
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
