"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Mic, Plus, Settings, Menu, X } from "lucide-react";
import { UserProfile } from "@/components/auth/user-profile";
import { useSession } from "@/lib/auth-client";
import { Button } from "./ui/button";
import { ModeToggle } from "./ui/mode-toggle";

const AUTH_ROUTES = ["/login", "/register", "/forgot-password", "/reset-password"];

export function SiteHeader() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Hide navigation bar on auth pages
  if (AUTH_ROUTES.some((route) => pathname === route || pathname.startsWith(route + "/"))) {
    return null;
  }

  const homeHref = session ? "/dashboard" : "/";

  return (
    <>
      {/* Skip to main content link for accessibility */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:px-4 focus:py-2 focus:bg-background focus:text-foreground focus:border focus:rounded-md"
      >
        Skip to main content
      </a>
      <header className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-50" role="banner">
        <nav
          className="container mx-auto px-3 sm:px-4 py-2 sm:py-3 flex justify-between items-center"
          aria-label="Main navigation"
        >
          <h1 className="text-xl sm:text-2xl font-bold">
            <Link
              href={homeHref}
              className="flex items-center gap-2 text-primary hover:text-primary/80 transition-colors"
              aria-label="Real Team Translation - Go to homepage"
            >
              <div
                className="flex items-center justify-center w-8 h-8 rounded-lg bg-primary/10"
                aria-hidden="true"
              >
                <Mic className="h-5 w-5" />
              </div>
              <span className="hidden sm:inline bg-gradient-to-r from-primary to-primary/70 bg-clip-text text-transparent">
                Real Team Translation
              </span>
              <span className="sm:hidden bg-gradient-to-r from-primary to-primary/70 bg-clip-text text-transparent">
                RealTT
              </span>
            </Link>
          </h1>
          <div className="flex items-center gap-1 sm:gap-3" role="group" aria-label="User actions">
            {session && (
              <>
                {/* Desktop: text button */}
                <Button asChild variant="ghost" size="sm" className="hidden sm:flex gap-1.5">
                  <Link href="/session/new">
                    <Plus className="h-4 w-4" />
                    <span className="hidden md:inline">New Session</span>
                  </Link>
                </Button>
                {/* Mobile: hamburger menu toggle */}
                <Button
                  variant="ghost"
                  size="icon"
                  className="sm:hidden min-w-[44px] min-h-[44px]"
                  onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                  aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
                  aria-expanded={mobileMenuOpen}
                >
                  {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
                </Button>
                <Button asChild variant="ghost" size="icon" className="hidden sm:flex">
                  <Link href="/settings" aria-label="Settings">
                    <Settings className="h-4 w-4" />
                  </Link>
                </Button>
              </>
            )}
            <UserProfile />
            <div className="hidden sm:block">
              <ModeToggle />
            </div>
          </div>
        </nav>

        {/* Mobile dropdown menu */}
        {session && mobileMenuOpen && (
          <div className="sm:hidden border-t bg-background/95 backdrop-blur">
            <div className="container mx-auto px-3 py-3 flex flex-col gap-1">
              <Button asChild variant="ghost" className="justify-start gap-2 min-h-[44px]">
                <Link href="/session/new" onClick={() => setMobileMenuOpen(false)}>
                  <Plus className="h-4 w-4" />
                  New Session
                </Link>
              </Button>
              <Button asChild variant="ghost" className="justify-start gap-2 min-h-[44px]">
                <Link href="/settings" onClick={() => setMobileMenuOpen(false)}>
                  <Settings className="h-4 w-4" />
                  Settings
                </Link>
              </Button>
              <div className="flex items-center justify-between px-4 py-2 min-h-[44px]">
                <span className="text-sm text-muted-foreground">Theme</span>
                <ModeToggle />
              </div>
            </div>
          </div>
        )}
      </header>
    </>
  );
}
