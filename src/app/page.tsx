"use client";

import Link from "next/link";
import {
  Mic,
  Languages,
  Users,
  FileText,
  Zap,
  Shield,
  ArrowRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSession } from "@/lib/auth-client";

export default function Home() {
  const { data: session } = useSession();

  return (
    <main className="flex-1">
      {/* Hero Section */}
      <section className="container mx-auto px-4 py-16 md:py-24">
        <div className="max-w-4xl mx-auto text-center space-y-6 animate-fade-up">
          <div className="flex items-center justify-center gap-3 mb-2">
            <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-primary/10">
              <Mic className="h-7 w-7 text-primary" />
            </div>
          </div>
          <h1 className="text-4xl sm:text-5xl font-bold tracking-tight bg-gradient-to-r from-primary via-primary/90 to-primary/70 bg-clip-text text-transparent">
            Real Team Translation
          </h1>
          <p className="text-xl sm:text-2xl font-semibold text-muted-foreground max-w-2xl mx-auto">
            Real-time transcription and translation for journalists
          </p>
          <p className="text-base sm:text-lg text-muted-foreground max-w-2xl mx-auto">
            Capture audio from meetings or calls, transcribe speech in real-time
            with speaker identification, and translate transcripts on-the-fly to
            your target language.
          </p>

          {/* CTA Buttons */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-4">
            {session ? (
              <Button asChild size="lg" className="gap-2">
                <Link href="/session/new">
                  Start New Session
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
            ) : (
              <Button asChild size="lg" className="gap-2">
                <Link href="/register">
                  Get Started
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
            )}
            {!session && (
              <Button asChild variant="outline" size="lg">
                <Link href="/login">Sign In</Link>
              </Button>
            )}
          </div>
        </div>
      </section>

      {/* Feature Highlights */}
      <section className="container mx-auto px-4 py-12 md:py-16">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-2xl sm:text-3xl font-bold text-center mb-10">
            Everything you need for multilingual coverage
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <div className="p-6 border rounded-lg card-interactive">
              <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-primary/10 mb-4">
                <Mic className="h-5 w-5 text-primary" />
              </div>
              <h3 className="font-semibold mb-2">Real-Time Transcription</h3>
              <p className="text-sm text-muted-foreground">
                Capture audio from your browser microphone and transcribe speech
                in real-time using advanced AI speech recognition.
              </p>
            </div>

            <div className="p-6 border rounded-lg card-interactive">
              <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-primary/10 mb-4">
                <Languages className="h-5 w-5 text-primary" />
              </div>
              <h3 className="font-semibold mb-2">Multi-Language Translation</h3>
              <p className="text-sm text-muted-foreground">
                Translate transcribed segments on-the-fly to your target language
                using powerful AI translation models via OpenRouter.
              </p>
            </div>

            <div className="p-6 border rounded-lg card-interactive">
              <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-primary/10 mb-4">
                <Users className="h-5 w-5 text-primary" />
              </div>
              <h3 className="font-semibold mb-2">Speaker Identification</h3>
              <p className="text-sm text-muted-foreground">
                Automatically identify and label different speakers in your
                recordings with speaker diarization technology.
              </p>
            </div>

            <div className="p-6 border rounded-lg card-interactive">
              <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-primary/10 mb-4">
                <FileText className="h-5 w-5 text-primary" />
              </div>
              <h3 className="font-semibold mb-2">Session Management</h3>
              <p className="text-sm text-muted-foreground">
                Save and organize your transcription sessions. Each session is
                stored securely and can be revisited at any time.
              </p>
            </div>

            <div className="p-6 border rounded-lg card-interactive">
              <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-primary/10 mb-4">
                <Zap className="h-5 w-5 text-primary" />
              </div>
              <h3 className="font-semibold mb-2">Export to Markdown</h3>
              <p className="text-sm text-muted-foreground">
                Export your completed transcripts and translations as clean
                Markdown files for easy sharing and publishing.
              </p>
            </div>

            <div className="p-6 border rounded-lg card-interactive">
              <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-primary/10 mb-4">
                <Shield className="h-5 w-5 text-primary" />
              </div>
              <h3 className="font-semibold mb-2">Secure & Private</h3>
              <p className="text-sm text-muted-foreground">
                Audio streams are never stored on disk. Only transcribed text is
                saved, and your data is protected with authenticated access.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="container mx-auto px-4 py-12 md:py-16">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-2xl sm:text-3xl font-bold text-center mb-10">
            How it works
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="text-center space-y-3">
              <div className="flex items-center justify-center w-12 h-12 rounded-full bg-primary text-primary-foreground mx-auto text-lg font-bold">
                1
              </div>
              <h3 className="font-semibold">Start a Session</h3>
              <p className="text-sm text-muted-foreground">
                Create a new transcription session and select your source and
                target languages.
              </p>
            </div>

            <div className="text-center space-y-3">
              <div className="flex items-center justify-center w-12 h-12 rounded-full bg-primary text-primary-foreground mx-auto text-lg font-bold">
                2
              </div>
              <h3 className="font-semibold">Record & Transcribe</h3>
              <p className="text-sm text-muted-foreground">
                Use your browser microphone to capture audio. Speech is
                transcribed in real-time with speaker labels.
              </p>
            </div>

            <div className="text-center space-y-3">
              <div className="flex items-center justify-center w-12 h-12 rounded-full bg-primary text-primary-foreground mx-auto text-lg font-bold">
                3
              </div>
              <h3 className="font-semibold">Export & Share</h3>
              <p className="text-sm text-muted-foreground">
                Review your translated transcript and export it as a Markdown file
                for publishing.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Bottom CTA */}
      <section className="container mx-auto px-4 py-12 md:py-16">
        <div className="max-w-2xl mx-auto text-center space-y-6 p-8 border rounded-lg bg-card">
          <h2 className="text-2xl font-bold">Ready to get started?</h2>
          <p className="text-muted-foreground">
            Start transcribing and translating meetings, interviews, and press
            conferences in real-time.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            {session ? (
              <Button asChild size="lg" className="gap-2">
                <Link href="/session/new">
                  Start New Session
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
            ) : (
              <Button asChild size="lg" className="gap-2">
                <Link href="/register">
                  Get Started
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}
