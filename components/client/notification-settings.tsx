"use client";

import { useState, useTransition, useMemo } from "react";
import { updateNotificationPreferences } from "@/app/actions/notification-preferences";
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
      smsMissedCheckInAlertTime !== initialSmsMissedCheckInAlertTime
    );
  }, [phoneNumber, smsOptIn, smsMealPlanUpdates, smsDailyCheckInReminder, smsCoachMessages, smsCheckInFeedback, smsCheckInReminderTime, smsClientCheckIns, smsMissedCheckInAlerts, smsClientMessages, smsNewClientSignups, smsMissedCheckInAlertTime, initialPhoneNumber, initialSmsOptIn, initialSmsMealPlanUpdates, initialSmsDailyCheckInReminder, initialSmsCoachMessages, initialSmsCheckInFeedback, initialSmsCheckInReminderTime, initialSmsClientCheckIns, initialSmsMissedCheckInAlerts, initialSmsClientMessages, initialSmsNewClientSignups, initialSmsMissedCheckInAlertTime]);

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
          smsMissedCheckInAlertTime
        });
        showToast("Settings saved");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to save");
      }
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2">
        <label htmlFor="phoneNumber" className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
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
            className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400"
            placeholder="+1234567890"
          />
        </div>
        {error && <p className="text-xs font-medium text-red-600 dark:text-red-400" role="alert">{error}</p>}
      </div>

      <div className="flex items-center justify-between gap-4 border-t border-zinc-200 dark:border-zinc-800 pt-6">
        <div>
          <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
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
        <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900/50">
          <p className="text-xs leading-relaxed text-zinc-500">
            By enabling SMS notifications you agree to receive transactional text messages from Steadfast
            regarding coaching updates, messages, and reminders. Message frequency varies. Message &amp; data
            rates may apply. Reply STOP to opt out.{" "}
            <a href="/sms-policy" className="underline hover:text-zinc-700 dark:hover:text-zinc-300">
              View SMS Policy
            </a>
          </p>
        </div>
      )}

      <div className={`space-y-8 pl-4 border-l-2 ${canToggleEvents ? "border-zinc-200 dark:border-zinc-800" : "border-transparent opacity-40"}`}>

        {/* CLIENT TOGGLES */}
        {(role === "CLIENT" || role === "BOTH") && (
          <div className="space-y-6">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
              Client Notifications
            </h3>

            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
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

            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
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
                  className="rounded border border-zinc-200 px-2 py-1 text-sm bg-white dark:bg-zinc-900 dark:border-zinc-800 dark:text-zinc-100 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500"
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
                <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
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
                <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
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
                <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
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

            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
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
                  className="rounded border border-zinc-200 px-2 py-1 text-sm bg-white dark:bg-zinc-900 dark:border-zinc-800 dark:text-zinc-100 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500"
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
                <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
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
                <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
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

      <div className="flex items-center justify-between gap-3 pt-4">
        {hasUnsavedChanges && (
          <p className="text-xs font-medium text-amber-600 dark:text-amber-400" role="status">
            Unsaved changes
          </p>
        )}
        <div className="ml-auto flex items-center gap-3">
          {toast && (
            <p className="text-xs font-medium text-emerald-600 dark:text-emerald-400" role="alert">
              {toast}
            </p>
          )}
          <button
            type="button"
            disabled={isPending || !hasUnsavedChanges}
            onClick={handleSave}
            className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 focus-visible:ring-offset-2 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300 whitespace-nowrap"
          >
            {isPending ? "Saving..." : "Save Preferences"}
          </button>
        </div>
      </div>
    </div>
  );
}
