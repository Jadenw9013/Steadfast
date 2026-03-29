"use client";

import { useState, useTransition, useMemo } from "react";
import { updateNotificationPreferences, updateCoachEmailPreferences } from "@/app/actions/notification-preferences";
import { Toggle } from "@/components/ui/toggle";

type Role = "CLIENT" | "COACH" | "BOTH";

export function NotificationSettings({
  role,
  initialPhoneNumber,
  initialSmsOptIn,
  initialSmsMealPlanUpdates,
  initialSmsDailyCheckInReminder,
  initialSmsCoachMessages,
  initialSmsCheckInFeedback,
  initialSmsCheckInReminderTime,
  initialSmsClientCheckIns,
  initialSmsMissedCheckInAlerts,
  initialSmsClientMessages,
  initialSmsNewClientSignups,
  initialSmsMissedCheckInAlertTime,
  // Email preferences
  initialEmailCheckInReminders,
  initialEmailMealPlanUpdates,
  initialEmailCoachMessages,
  initialEmailClientCheckIns,
  initialEmailClientMessages,
  initialEmailCoachingRequests,
}: {
  role: Role;
  initialPhoneNumber: string;
  initialSmsOptIn: boolean;
  initialSmsMealPlanUpdates: boolean;
  initialSmsDailyCheckInReminder: boolean;
  initialSmsCoachMessages: boolean;
  initialSmsCheckInFeedback: boolean;
  initialSmsCheckInReminderTime: string;
  initialSmsClientCheckIns: boolean;
  initialSmsMissedCheckInAlerts: boolean;
  initialSmsClientMessages: boolean;
  initialSmsNewClientSignups: boolean;
  initialSmsMissedCheckInAlertTime: string;
  // Email preferences
  initialEmailCheckInReminders: boolean;
  initialEmailMealPlanUpdates: boolean;
  initialEmailCoachMessages: boolean;
  initialEmailClientCheckIns: boolean;
  initialEmailClientMessages: boolean;
  initialEmailCoachingRequests: boolean;
}) {
  const [phoneNumber, setPhoneNumber] = useState(initialPhoneNumber);
  const [smsOptIn, setSmsOptIn] = useState(initialSmsOptIn);

  // Client Toggles
  const [smsMealPlanUpdates, setSmsMealPlanUpdates] = useState(initialSmsMealPlanUpdates);
  const [smsDailyCheckInReminder, setSmsDailyCheckInReminder] = useState(initialSmsDailyCheckInReminder);
  const [smsCoachMessages, setSmsCoachMessages] = useState(initialSmsCoachMessages);
  const [smsCheckInFeedback, setSmsCheckInFeedback] = useState(initialSmsCheckInFeedback);
  const [smsCheckInReminderTime, setSmsCheckInReminderTime] = useState(initialSmsCheckInReminderTime);

  // Coach Toggles
  const [smsClientCheckIns, setSmsClientCheckIns] = useState(initialSmsClientCheckIns);
  const [smsMissedCheckInAlerts, setSmsMissedCheckInAlerts] = useState(initialSmsMissedCheckInAlerts);
  const [smsClientMessages, setSmsClientMessages] = useState(initialSmsClientMessages);
  const [smsNewClientSignups, setSmsNewClientSignups] = useState(initialSmsNewClientSignups);
  const [smsMissedCheckInAlertTime, setSmsMissedCheckInAlertTime] = useState(initialSmsMissedCheckInAlertTime);

  // Email preferences
  const [emailCheckInReminders, setEmailCheckInReminders] = useState(initialEmailCheckInReminders);
  const [emailMealPlanUpdates, setEmailMealPlanUpdates] = useState(initialEmailMealPlanUpdates);
  const [emailCoachMessages, setEmailCoachMessages] = useState(initialEmailCoachMessages);
  const [emailClientCheckIns, setEmailClientCheckIns] = useState(initialEmailClientCheckIns);
  const [emailClientMessages, setEmailClientMessages] = useState(initialEmailClientMessages);
  const [emailCoachingRequests, setEmailCoachingRequests] = useState(initialEmailCoachingRequests);

  const [isPending, startTransition] = useTransition();
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canToggleEvents = smsOptIn && phoneNumber.length > 0;

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 2000);
  }

  const hasUnsavedChanges = useMemo(() => {
    return (
      phoneNumber !== initialPhoneNumber ||
      smsOptIn !== initialSmsOptIn ||
      smsMealPlanUpdates !== initialSmsMealPlanUpdates ||
      smsDailyCheckInReminder !== initialSmsDailyCheckInReminder ||
      smsCoachMessages !== initialSmsCoachMessages ||
      smsCheckInFeedback !== initialSmsCheckInFeedback ||
      smsCheckInReminderTime !== initialSmsCheckInReminderTime ||
      smsClientCheckIns !== initialSmsClientCheckIns ||
      smsMissedCheckInAlerts !== initialSmsMissedCheckInAlerts ||
      smsClientMessages !== initialSmsClientMessages ||
      smsNewClientSignups !== initialSmsNewClientSignups ||
      smsMissedCheckInAlertTime !== initialSmsMissedCheckInAlertTime ||
      emailCheckInReminders !== initialEmailCheckInReminders ||
      emailMealPlanUpdates !== initialEmailMealPlanUpdates ||
      emailCoachMessages !== initialEmailCoachMessages ||
      emailClientCheckIns !== initialEmailClientCheckIns ||
      emailClientMessages !== initialEmailClientMessages ||
      emailCoachingRequests !== initialEmailCoachingRequests
    );
  }, [phoneNumber, smsOptIn, smsMealPlanUpdates, smsDailyCheckInReminder, smsCoachMessages, smsCheckInFeedback, smsCheckInReminderTime, smsClientCheckIns, smsMissedCheckInAlerts, smsClientMessages, smsNewClientSignups, smsMissedCheckInAlertTime, emailCheckInReminders, emailMealPlanUpdates, emailCoachMessages, emailClientCheckIns, emailClientMessages, emailCoachingRequests, initialPhoneNumber, initialSmsOptIn, initialSmsMealPlanUpdates, initialSmsDailyCheckInReminder, initialSmsCoachMessages, initialSmsCheckInFeedback, initialSmsCheckInReminderTime, initialSmsClientCheckIns, initialSmsMissedCheckInAlerts, initialSmsClientMessages, initialSmsNewClientSignups, initialSmsMissedCheckInAlertTime, initialEmailCheckInReminders, initialEmailMealPlanUpdates, initialEmailCoachMessages, initialEmailClientCheckIns, initialEmailClientMessages, initialEmailCoachingRequests]);

  function handleSave() {
    setError(null);

    const submitPhone = phoneNumber.trim();
    let submitOptIn = smsOptIn;

    if (!submitPhone) {
      // Enforce DB Rule B2: auto-disable everything if phone is cleared
      submitOptIn = false;
      setSmsOptIn(false);
    } else if (submitOptIn) {
      if (!/^\+[1-9]\d{10,14}$/.test(submitPhone)) {
        setError("Please use valid international E.164 format (e.g. +1234567890)");
        return;
      }
    }

    startTransition(async () => {
      try {
        await updateNotificationPreferences({
          phoneNumber: submitPhone,
          smsOptIn: submitOptIn,
          smsMealPlanUpdates,
          smsDailyCheckInReminder,
          smsCoachMessages,
          smsCheckInFeedback,
          smsCheckInReminderTime,
          smsClientCheckIns,
          smsMissedCheckInAlerts,
          smsClientMessages,
          smsNewClientSignups,
          smsMissedCheckInAlertTime,
          // Client email preferences
          emailCheckInReminders,
          emailMealPlanUpdates,
          emailCoachMessages,
        });
        // Coach email preferences (separate action with role guard)
        if (role === "COACH" || role === "BOTH") {
          await updateCoachEmailPreferences({
            emailClientCheckIns,
            emailClientMessages,
            emailCoachingRequests,
          });
        }
        showToast("Settings saved");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to save");
      }
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2">
        <label htmlFor="phoneNumber" className="text-sm font-medium text-zinc-100">
          Phone Number <span className="text-zinc-400 font-normal">(Optional)</span>
        </label>
        <p id="phone-help" className="text-xs text-zinc-500">
          Must include country code, e.g. +1234567890. Leave blank to disable SMS altogether.
        </p>
        <div className="flex max-w-sm gap-2">
          <input
            id="phoneNumber"
            type="tel"
            value={phoneNumber}
            onChange={(e) => setPhoneNumber(e.target.value)}
            disabled={isPending}
            aria-describedby="phone-help"
            className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 placeholder:text-zinc-500"
            placeholder="+1234567890"
          />
        </div>
        {error && <p className="text-xs font-medium text-red-400" role="alert">{error}</p>}
      </div>

      <div className="flex items-center justify-between gap-4 border-t border-white/10 pt-6">
        <div>
          <p className="text-sm font-medium text-zinc-100">
            Receive SMS Notifications
          </p>
          <p className="text-xs text-zinc-500">
            Allow text messages to be sent to your phone number.
          </p>
        </div>
        <Toggle
          checked={smsOptIn}
          onChange={() => setSmsOptIn(!smsOptIn)}
          label="Receive SMS Notifications"
          disabled={isPending || !phoneNumber}
        />
      </div>

      {smsOptIn && phoneNumber && (
        <div className="rounded-lg border border-white/10 bg-white/[0.03] px-4 py-3">
          <p className="text-xs leading-relaxed text-zinc-500">
            By enabling SMS notifications you agree to receive transactional text messages from Steadfast
            regarding coaching updates, messages, and reminders. Message frequency varies. Message &amp; data
            rates may apply. Reply STOP to opt out.{" "}
            <a href="/sms-policy" className="underline hover:text-zinc-700">
              View SMS Policy
            </a>
          </p>
        </div>
      )}

      <div className={`space-y-8 pl-4 border-l-2 ${canToggleEvents ? "border-white/10" : "border-transparent opacity-40"}`}>

        {/* CLIENT TOGGLES */}
        {(role === "CLIENT" || role === "BOTH") && (
          <div className="space-y-6">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
              Client Notifications
            </h3>

            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-zinc-100">
                  Meal Plan Updates
                </p>
                <p className="text-xs text-zinc-500">
                  Text me when my coach updates my meal plan.
                </p>
              </div>
              <Toggle
                checked={smsMealPlanUpdates}
                onChange={() => setSmsMealPlanUpdates(!smsMealPlanUpdates)}
                label="Meal Plan Updates"
                disabled={isPending || !canToggleEvents}
              />
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
              <div>
                <p className="text-sm font-medium text-zinc-100">
                  Daily Check-in Reminder
                </p>
                <p className="text-xs text-zinc-500">
                  Daily text if you haven&apos;t checked in yet.
                </p>
              </div>
              <div className="flex items-center gap-3">
                <input
                  type="time"
                  value={smsCheckInReminderTime}
                  onChange={(e) => setSmsCheckInReminderTime(e.target.value)}
                  disabled={isPending || !canToggleEvents || !smsDailyCheckInReminder}
                  aria-label="Daily Check-in Reminder Time"
                  className="rounded border border-white/10 bg-white/5 px-2 py-1 text-sm text-zinc-100 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500"
                />
                <Toggle
                  checked={smsDailyCheckInReminder}
                  onChange={() => setSmsDailyCheckInReminder(!smsDailyCheckInReminder)}
                  label="Daily Check-in Reminder"
                  disabled={isPending || !canToggleEvents}
                />
              </div>
            </div>

            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-zinc-100">
                  Coach Messages
                </p>
                <p className="text-xs text-zinc-500">
                  Text me when my coach sends a chat message.
                </p>
              </div>
              <Toggle
                checked={smsCoachMessages}
                onChange={() => setSmsCoachMessages(!smsCoachMessages)}
                label="Coach Messages"
                disabled={isPending || !canToggleEvents}
              />
            </div>

            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-zinc-100">
                  Check-in Feedback
                </p>
                <p className="text-xs text-zinc-500">
                  Text me when my coach reviews my check-in.
                </p>
              </div>
              <Toggle
                checked={smsCheckInFeedback}
                onChange={() => setSmsCheckInFeedback(!smsCheckInFeedback)}
                label="Check-in Feedback"
                disabled={isPending || !canToggleEvents}
              />
            </div>
          </div>
        )}

        {/* COACH TOGGLES */}
        {(role === "COACH" || role === "BOTH") && (
          <div className="space-y-6 pt-4">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
              Coach Notifications
            </h3>

            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-zinc-100">
                  Client Check-ins
                </p>
                <p className="text-xs text-zinc-500">
                  Text me when a client submits their check-in.
                </p>
              </div>
              <Toggle
                checked={smsClientCheckIns}
                onChange={() => setSmsClientCheckIns(!smsClientCheckIns)}
                label="Client Check-ins"
                disabled={isPending || !canToggleEvents}
              />
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
              <div>
                <p className="text-sm font-medium text-zinc-100">
                  Missed Check-in Alerts
                </p>
                <p className="text-xs text-zinc-500">
                  Daily text summarizing clients who missed check-ins.
                </p>
              </div>
              <div className="flex items-center gap-3">
                <input
                  type="time"
                  value={smsMissedCheckInAlertTime}
                  onChange={(e) => setSmsMissedCheckInAlertTime(e.target.value)}
                  disabled={isPending || !canToggleEvents || !smsMissedCheckInAlerts}
                  aria-label="Missed Check-in Alert Time"
                  className="rounded border border-white/10 bg-white/5 px-2 py-1 text-sm text-zinc-100 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500"
                />
                <Toggle
                  checked={smsMissedCheckInAlerts}
                  onChange={() => setSmsMissedCheckInAlerts(!smsMissedCheckInAlerts)}
                  label="Missed Check-in Alerts"
                  disabled={isPending || !canToggleEvents}
                />
              </div>
            </div>

            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-zinc-100">
                  Client Messages
                </p>
                <p className="text-xs text-zinc-500">
                  Text me when a client sends a chat message.
                </p>
              </div>
              <Toggle
                checked={smsClientMessages}
                onChange={() => setSmsClientMessages(!smsClientMessages)}
                label="Client Messages"
                disabled={isPending || !canToggleEvents}
              />
            </div>

            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-zinc-100">
                  New Client Signups
                </p>
                <p className="text-xs text-zinc-500">
                  Text me when a new client joins my roster.
                </p>
              </div>
              <Toggle
                checked={smsNewClientSignups}
                onChange={() => setSmsNewClientSignups(!smsNewClientSignups)}
                label="New Client Signups"
                disabled={isPending || !canToggleEvents}
              />
            </div>
          </div>
        )}

      </div>

      {/* ── Email Notifications ──────────────────────────────────────────── */}
      <div className="border-t border-white/10 pt-6 space-y-6">
        <div>
          <p className="text-sm font-medium text-zinc-100">
            Email Notifications
          </p>
          <p className="text-xs text-zinc-500">
            Manage which emails you receive. Transactional emails (welcome, coach connected, check-in reviewed, meal plan updated) are always sent.
          </p>
        </div>

        {/* CLIENT EMAIL TOGGLES */}
        {(role === "CLIENT" || role === "BOTH") && (
          <div className="space-y-4">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
              Client Email Notifications
            </h3>

            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-zinc-100">
                  Check-in Reminders
                </p>
                <p className="text-xs text-zinc-500">
                  Email me when a check-in is due.
                </p>
              </div>
              <Toggle
                checked={emailCheckInReminders}
                onChange={() => setEmailCheckInReminders(!emailCheckInReminders)}
                label="Email Check-in Reminders"
                disabled={isPending}
              />
            </div>

            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-zinc-100">
                  Meal Plan Updates
                </p>
                <p className="text-xs text-zinc-500">
                  Email me when my coach updates my meal plan.
                </p>
              </div>
              <Toggle
                checked={emailMealPlanUpdates}
                onChange={() => setEmailMealPlanUpdates(!emailMealPlanUpdates)}
                label="Email Meal Plan Updates"
                disabled={isPending}
              />
            </div>

            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-zinc-100">
                  Coach Messages
                </p>
                <p className="text-xs text-zinc-500">
                  Email me when my coach sends a message.
                </p>
              </div>
              <Toggle
                checked={emailCoachMessages}
                onChange={() => setEmailCoachMessages(!emailCoachMessages)}
                label="Email Coach Messages"
                disabled={isPending}
              />
            </div>
          </div>
        )}

        {/* COACH EMAIL TOGGLES */}
        {(role === "COACH" || role === "BOTH") && (
          <div className="space-y-4">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
              Coach Email Notifications
            </h3>

            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-zinc-100">
                  Client Check-ins
                </p>
                <p className="text-xs text-zinc-500">
                  Email me when a client submits a check-in.
                </p>
              </div>
              <Toggle
                checked={emailClientCheckIns}
                onChange={() => setEmailClientCheckIns(!emailClientCheckIns)}
                label="Email Client Check-ins"
                disabled={isPending}
              />
            </div>

            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-zinc-100">
                  Client Messages
                </p>
                <p className="text-xs text-zinc-500">
                  Email me when a client sends a message.
                </p>
              </div>
              <Toggle
                checked={emailClientMessages}
                onChange={() => setEmailClientMessages(!emailClientMessages)}
                label="Email Client Messages"
                disabled={isPending}
              />
            </div>

            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-zinc-100">
                  Coaching Requests
                </p>
                <p className="text-xs text-zinc-500">
                  Email me when a prospect submits a coaching request.
                </p>
              </div>
              <Toggle
                checked={emailCoachingRequests}
                onChange={() => setEmailCoachingRequests(!emailCoachingRequests)}
                label="Email Coaching Requests"
                disabled={isPending}
              />
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-3 pt-4">
        {hasUnsavedChanges && (
          <p className="text-xs font-medium text-amber-400" role="status">
            Unsaved changes
          </p>
        )}
        <div className="ml-auto flex items-center gap-3">
          {toast && (
            <p className="text-xs font-medium text-emerald-400" role="alert">
              {toast}
            </p>
          )}
          <button
            type="button"
            disabled={isPending || !hasUnsavedChanges}
            onClick={handleSave}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-black disabled:opacity-50 whitespace-nowrap"
          >
            {isPending ? "Saving..." : "Save Preferences"}
          </button>
        </div>
      </div>
    </div>
  );
}
