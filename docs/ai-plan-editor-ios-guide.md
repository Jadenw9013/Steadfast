# AI Plan Editor — Architecture & iOS Implementation Guide

## Table of Contents

1. [Feature Overview](#feature-overview)
2. [Web Architecture (How It Works Today)](#web-architecture)
3. [API Contract](#api-contract)
4. [Data Flow](#data-flow)
5. [iOS Implementation Guide](#ios-implementation-guide)
6. [Swift Code Examples](#swift-code-examples)
7. [UI/UX Specifications](#uiux-specifications)

---

## Feature Overview

The AI Plan Editor allows coaches to modify a client's meal plan using **natural language instructions**. Instead of manually editing individual food items, portions, and meals, the coach types something like:

- *"Add a bagel to meal 2 on Mondays and Fridays"*
- *"Increase carb portions across all meals"*
- *"Replace chicken breast with salmon in meal 3"*
- *"Create a high carb day override for Saturdays"*

The system sends the current meal plan + instruction to an LLM (GPT-4o), receives the complete modified plan back, generates a visual diff of changes, and lets the coach review before applying.

### Key Design Principles

| Principle | Description |
|-----------|-------------|
| **Non-destructive** | Changes are previewed before applying — coach must explicitly confirm |
| **Full-plan round-trip** | The LLM returns the ENTIRE plan, not just the diff. This avoids merge errors |
| **Quick Actions** | Pre-built prompts for common operations reduce typing |
| **Structured diff** | Changes are computed client-side by comparing before/after meal groups |

---

## Web Architecture

### Component Tree

```
AiPlanAssistant (drawer panel)
├── Header (title + close button)
├── Body (phase-dependent)
│   ├── Idle Phase
│   │   ├── Quick Actions Grid (9 buttons)
│   │   └── Instruction Textarea
│   ├── Thinking Phase
│   │   └── AiThinkingAnimation (staged progress)
│   ├── Preview Phase
│   │   ├── Summary Banner
│   │   ├── Change List (diff entries)
│   │   └── Edit Instruction Textarea
│   └── Error Phase
│       ├── Error Banner
│       └── Retry Textarea
└── Footer (phase-dependent action buttons)
    ├── Idle: "Apply AI Edit"
    ├── Thinking: "Cancel"
    ├── Preview: "Cancel" | "Retry" | "Apply Changes"
    └── Error: "Cancel" | "Try Again"
```

### State Machine

The component uses a 4-phase state machine:

```
┌──────┐   submit    ┌──────────┐   success   ┌─────────┐   apply   ┌──────┐
│ IDLE │────────────▶│ THINKING │────────────▶│ PREVIEW │─────────▶│ IDLE │
└──────┘             └──────────┘             └─────────┘          └──────┘
                          │                       │
                          │ error                 │ retry
                          ▼                       │
                     ┌─────────┐                  │
                     │  ERROR  │──────────────────┘
                     └─────────┘     retry
```

### Key Files (Web)

| File | Purpose |
|------|---------|
| `components/coach/meal-plan/ai-plan-assistant.tsx` | Main UI component (drawer panel) |
| `components/coach/meal-plan/ai-thinking-animation.tsx` | Loading animation with staged progress |
| `app/api/mealplans/modify-plan/route.ts` | API route — validates input, calls LLM |
| `lib/llm/modify-meal-plan.ts` | LLM integration — system prompt, OpenAI call, response validation |
| `lib/validations/meal-plan-import.ts` | Zod schema for parsed meal plans |
| `lib/utils/diff-meal-plan.ts` | Diff engine — compares two meal plans and produces change entries |
| `types/meal-plan.ts` | Core meal plan types (`MealGroup`, `MealPlanFoodItem`) |
| `types/meal-plan-extras.ts` | Extended types (`PlanExtras`, `DayOverride`, etc.) |

---

## API Contract

### Endpoint

```
POST /api/mealplans/modify-plan
```

### Authentication

Requires the user to be authenticated (via Clerk session) AND have the `COACH` role.

### Request Body

```json
{
  "currentPlan": {
    "title": "Meal Plan",
    "meals": [
      {
        "name": "Meal 1",
        "items": [
          { "food": "eggs", "portion": "3" },
          { "food": "whey isolate protein", "portion": "1 scoop" },
          { "food": "bagel", "portion": "1" },
          { "food": "banana", "portion": "1" }
        ]
      },
      {
        "name": "Meal 2",
        "items": [
          { "food": "93/7 ground beef", "portion": "6 oz" },
          { "food": "cooked rice", "portion": "200g" },
          { "food": "pineapple", "portion": "75g" }
        ]
      }
    ],
    "extras": {
      "dayOverrides": [],
      "metadata": {
        "phase": "maintenance",
        "coachNotes": "Focus on high protein"
      }
    },
    "supportContent": "## Supplements\n- 5g creatine daily\n- Multivitamin with breakfast"
  },
  "instruction": "Add a bagel to meal 2 on Mondays and Fridays"
}
```

### Response Body (Success — 200)

```json
{
  "plan": {
    "title": "Meal Plan",
    "meals": [
      {
        "name": "Meal 1",
        "items": [
          { "food": "eggs", "portion": "3" },
          { "food": "whey isolate protein", "portion": "1 scoop" },
          { "food": "bagel", "portion": "1" },
          { "food": "banana", "portion": "1" }
        ]
      },
      {
        "name": "Meal 2",
        "items": [
          { "food": "93/7 ground beef", "portion": "6 oz" },
          { "food": "cooked rice", "portion": "200g" },
          { "food": "pineapple", "portion": "75g" }
        ]
      }
    ],
    "notes": "",
    "metadata": {
      "phase": "maintenance",
      "coachNotes": "Focus on high protein",
      "highlightedChanges": "Added bagel to Meal 2 on Monday/Friday via day override"
    },
    "dayOverrides": [
      {
        "label": "Monday & Friday",
        "color": "blue",
        "weekdays": ["Monday", "Friday"],
        "mealAdjustments": [
          {
            "mealName": "Meal 2",
            "changes": [
              {
                "type": "add",
                "food": "bagel",
                "newPortion": "1"
              }
            ]
          }
        ]
      }
    ],
    "supportContent": "## Supplements\n- 5g creatine daily\n- Multivitamin with breakfast"
  }
}
```

### Response Body (Error — 400/401/403/500)

```json
{
  "error": "Human-readable error message",
  "details": { }
}
```

### Response Schema Reference

The `plan` object in the response follows this schema:

```
ParsedMealPlan {
  title: string
  meals: [{
    name: string
    items: [{
      food: string
      portion: string        // e.g. "6 oz", "200g", "1 cup"
      notes?: string
    }]
  }]
  notes?: string
  metadata?: {
    phase?: string
    startDate?: string
    bodyweight?: string
    coachNotes?: string
    highlightedChanges: string   // ← ALWAYS present, describes what AI changed
  }
  dayOverrides?: [{
    label: string                // e.g. "High Carb Day"
    color: string                // blue|emerald|amber|rose|purple|teal
    weekdays: [string]           // e.g. ["Monday", "Friday"]
    mealAdjustments: [{
      mealName: string
      changes: [{
        type: "update" | "add" | "remove" | "replace"
        food: string
        newPortion?: string
        replacementFood?: string
        replacementPortion?: string
      }]
      notes?: string
    }]
    notes?: string
  }]
  supportContent?: string        // Markdown string for supplements, rules, etc.
}
```

---

## Data Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                        iOS App (Client)                             │
│                                                                     │
│  1. Coach opens AI Editor sheet                                     │
│  2. Coach types instruction or taps Quick Action                    │
│  3. App serializes currentPlan → JSON                               │
│  4. POST /api/mealplans/modify-plan { currentPlan, instruction }    │
│  5. Receive modified plan JSON                                      │
│  6. Diff (local): compare currentMeals vs newMeals                  │
│  7. Show preview with change list                                   │
│  8. Coach taps "Apply" → replace local plan state                   │
│  9. Save to backend (existing meal plan save flow)                  │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                       Server (Next.js API)                          │
│                                                                     │
│  1. Validate auth (Clerk session) + coach role                      │
│  2. Validate request body (Zod schema)                              │
│  3. Serialize current plan + instruction into LLM prompt            │
│  4. Call OpenAI GPT-4o with JSON mode                               │
│  5. Parse + validate response against ParsedMealPlan schema         │
│  6. Return { plan: ParsedMealPlan }                                 │
└─────────────────────────────────────────────────────────────────────┘
```

---

## iOS Implementation Guide

### Step 1: Define Swift Models

Create Codable structs that mirror the API contract:

```swift
// MARK: - Request Models

struct ModifyPlanRequest: Codable {
    let currentPlan: CurrentPlan
    let instruction: String
}

struct CurrentPlan: Codable {
    let title: String
    let meals: [APIMeal]
    let extras: PlanExtras?
    let supportContent: String?
}

struct APIMeal: Codable {
    let name: String
    let items: [APIMealItem]
}

struct APIMealItem: Codable {
    let food: String
    let portion: String
}

struct PlanExtras: Codable {
    let dayOverrides: [DayOverride]?
    let metadata: PlanMetadata?
}

// MARK: - Response Models

struct ModifyPlanResponse: Codable {
    let plan: ParsedMealPlan
}

struct ParsedMealPlan: Codable {
    let title: String
    let meals: [APIMeal]
    let notes: String?
    let metadata: PlanMetadata?
    let dayOverrides: [DayOverride]?
    let supportContent: String?
}

struct PlanMetadata: Codable {
    let phase: String?
    let startDate: String?
    let bodyweight: String?
    let coachNotes: String?
    let highlightedChanges: String?
}

struct DayOverride: Codable {
    let label: String
    let color: String
    let weekdays: [String]?
    let mealAdjustments: [MealAdjustment]?
    let notes: String?
}

struct MealAdjustment: Codable {
    let mealName: String
    let changes: [MealChange]
    let notes: String?
}

struct MealChange: Codable {
    let type: String       // "update" | "add" | "remove" | "replace"
    let food: String
    let newPortion: String?
    let replacementFood: String?
    let replacementPortion: String?
}
```

### Step 2: Create the API Service

```swift
import Foundation

enum AIEditorError: LocalizedError {
    case notAuthenticated
    case notCoach
    case invalidResponse
    case serverError(String)
    case networkError(Error)

    var errorDescription: String? {
        switch self {
        case .notAuthenticated: return "Not authenticated"
        case .notCoach: return "Coach access required"
        case .invalidResponse: return "Invalid response from server"
        case .serverError(let msg): return msg
        case .networkError(let err): return err.localizedDescription
        }
    }
}

actor AIPlanEditorService {
    static let shared = AIPlanEditorService()

    private let baseURL: URL
    private let session: URLSession
    private let decoder: JSONDecoder

    init() {
        // Replace with your actual API base URL
        self.baseURL = URL(string: "https://your-domain.com")!
        self.session = .shared
        self.decoder = JSONDecoder()
    }

    func modifyPlan(
        currentPlan: CurrentPlan,
        instruction: String
    ) async throws -> ParsedMealPlan {
        let url = baseURL.appendingPathComponent("/api/mealplans/modify-plan")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        // Add your auth token here:
        // request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

        let body = ModifyPlanRequest(
            currentPlan: currentPlan,
            instruction: instruction
        )
        request.httpBody = try JSONEncoder().encode(body)

        // 60s timeout — LLM calls can be slow
        request.timeoutInterval = 60

        let (data, response) = try await session.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw AIEditorError.invalidResponse
        }

        switch httpResponse.statusCode {
        case 200:
            let result = try decoder.decode(ModifyPlanResponse.self, from: data)
            return result.plan
        case 401:
            throw AIEditorError.notAuthenticated
        case 403:
            throw AIEditorError.notCoach
        default:
            if let errorBody = try? decoder.decode(
                [String: String].self, from: data
            ) {
                throw AIEditorError.serverError(
                    errorBody["error"] ?? "Unknown error"
                )
            }
            throw AIEditorError.serverError(
                "Request failed (\(httpResponse.statusCode))"
            )
        }
    }
}
```

### Step 3: Build the Diff Engine

The diff engine compares two sets of meals to produce human-readable changes:

```swift
// MARK: - Change Entry

enum ChangeType: String {
    case added, removed, modified, info
}

enum ChangeCategory: String {
    case meal, item, supplement, override, support, meta
}

struct ChangeEntry: Identifiable {
    let id = UUID()
    let type: ChangeType
    let category: ChangeCategory
    let label: String
    let detail: String?
}

// MARK: - Diff Engine

struct MealPlanDiffer {
    /// Compare two meal plan states and return a list of changes
    static func diff(
        before: [APIMeal],
        after: [APIMeal],
        overridesBefore: [DayOverride] = [],
        overridesAfter: [DayOverride] = [],
        supportBefore: String? = nil,
        supportAfter: String? = nil
    ) -> [ChangeEntry] {
        var changes: [ChangeEntry] = []

        let beforeNames = Set(before.map(\.name))
        let afterNames = Set(after.map(\.name))

        // New meals
        for meal in after where !beforeNames.contains(meal.name) {
            changes.append(.init(
                type: .added,
                category: .meal,
                label: "New meal: \(meal.name)",
                detail: "\(meal.items.count) item\(meal.items.count != 1 ? "s" : "")"
            ))
        }

        // Removed meals
        for meal in before where !afterNames.contains(meal.name) {
            changes.append(.init(
                type: .removed,
                category: .meal,
                label: "Removed: \(meal.name)",
                detail: nil
            ))
        }

        // Item-level changes within shared meals
        for afterMeal in after {
            guard let beforeMeal = before.first(where: { $0.name == afterMeal.name }) else {
                continue
            }

            let beforeFoods = Dictionary(
                uniqueKeysWithValues: beforeMeal.items.map {
                    ($0.food.lowercased(), $0)
                }
            )
            let afterFoods = Dictionary(
                uniqueKeysWithValues: afterMeal.items.map {
                    ($0.food.lowercased(), $0)
                }
            )

            // Added items
            for (key, item) in afterFoods where beforeFoods[key] == nil {
                changes.append(.init(
                    type: .added,
                    category: .item,
                    label: "\(afterMeal.name): + \(item.food)",
                    detail: item.portion.isEmpty ? nil : item.portion
                ))
            }

            // Removed items
            for (key, item) in beforeFoods where afterFoods[key] == nil {
                changes.append(.init(
                    type: .removed,
                    category: .item,
                    label: "\(afterMeal.name): − \(item.food)",
                    detail: nil
                ))
            }

            // Modified portions
            for (key, afterItem) in afterFoods {
                guard let beforeItem = beforeFoods[key] else { continue }
                if beforeItem.portion != afterItem.portion {
                    changes.append(.init(
                        type: .modified,
                        category: .item,
                        label: "\(afterMeal.name): \(afterItem.food)",
                        detail: "\(beforeItem.portion) → \(afterItem.portion)"
                    ))
                }
            }
        }

        // Day override changes
        let beforeLabels = Set(overridesBefore.map(\.label))
        for override in overridesAfter where !beforeLabels.contains(override.label) {
            changes.append(.init(
                type: .added,
                category: .override,
                label: "Day override: \(override.label)",
                detail: override.weekdays?.joined(separator: ", ")
            ))
        }

        // Support content changes
        if supportBefore != supportAfter {
            changes.append(.init(
                type: .modified,
                category: .support,
                label: "Support notes updated",
                detail: "Guidance, rules, or supplements were modified"
            ))
        }

        return changes
    }
}
```

### Step 4: Create the ViewModel

```swift
import SwiftUI

@MainActor
final class AIPlanEditorViewModel: ObservableObject {

    // MARK: - State

    enum Phase: Equatable {
        case idle
        case thinking
        case preview(summary: String)
        case error(message: String)
    }

    @Published var phase: Phase = .idle
    @Published var instruction: String = ""
    @Published var changes: [ChangeEntry] = []
    @Published private(set) var newPlan: ParsedMealPlan?

    // Injected from parent
    let currentMeals: [APIMeal]
    let currentExtras: PlanExtras?
    let currentSupport: String?

    init(
        currentMeals: [APIMeal],
        currentExtras: PlanExtras?,
        currentSupport: String?
    ) {
        self.currentMeals = currentMeals
        self.currentExtras = currentExtras
        self.currentSupport = currentSupport
    }

    // MARK: - Quick Actions

    static let quickActions: [(label: String, icon: String, prompt: String)] = [
        ("Increase carbs",       "fork.knife",             "Increase carb portions across all meals"),
        ("Add high-carb day",    "chart.line.uptrend.xyaxis", "Create a high carb day override for"),
        ("Replace ingredient",   "arrow.triangle.2.circlepath", "Replace "),
        ("Add food to meal",     "plus.circle",            "Add "),
        ("Remove ingredient",    "trash",                  "Remove "),
        ("Adjust portions",      "slider.horizontal.3",    "Change the portion of "),
        ("Add supplement",       "pill",                   "Add a supplement: "),
        ("Create day override",  "calendar",               "Create a day override for "),
        ("Custom instruction",   "pencil.and.outline",     ""),
    ]

    // MARK: - Actions

    func submit() async {
        let trimmed = instruction.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, phase != .thinking else { return }

        phase = .thinking

        do {
            let currentPlan = CurrentPlan(
                title: "Meal Plan",
                meals: currentMeals,
                extras: currentExtras,
                supportContent: currentSupport
            )

            let result = try await AIPlanEditorService.shared.modifyPlan(
                currentPlan: currentPlan,
                instruction: trimmed
            )

            newPlan = result

            // Compute diff
            let diffChanges = MealPlanDiffer.diff(
                before: currentMeals,
                after: result.meals,
                overridesBefore: currentExtras?.dayOverrides ?? [],
                overridesAfter: result.dayOverrides ?? [],
                supportBefore: currentSupport,
                supportAfter: result.supportContent
            )

            changes = diffChanges

            let summary = result.metadata?.highlightedChanges
                ?? (diffChanges.isEmpty
                    ? "No changes detected"
                    : "\(diffChanges.count) change\(diffChanges.count != 1 ? "s" : "") detected")

            phase = .preview(summary: summary)

        } catch {
            phase = .error(message: error.localizedDescription)
        }
    }

    func applyQuickAction(_ prompt: String) {
        instruction = prompt
    }

    func reset() {
        phase = .idle
    }
}
```

### Step 5: Build the SwiftUI View

```swift
import SwiftUI

struct AIPlanEditorSheet: View {
    @StateObject var vm: AIPlanEditorViewModel
    @Environment(\.dismiss) private var dismiss

    /// Called when coach confirms changes — parent replaces its plan state
    let onApply: (ParsedMealPlan) -> Void

    var body: some View {
        NavigationStack {
            ZStack {
                Color.black.ignoresSafeArea()

                ScrollView {
                    VStack(spacing: 24) {
                        switch vm.phase {
                        case .idle:
                            idleView
                        case .thinking:
                            thinkingView
                        case .preview(let summary):
                            previewView(summary: summary)
                        case .error(let message):
                            errorView(message: message)
                        }
                    }
                    .padding(.horizontal, 20)
                    .padding(.top, 8)
                }
            }
            .navigationTitle("AI Plan Editor")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") { dismiss() }
                        .foregroundStyle(.secondary)
                }
            }
            .safeAreaInset(edge: .bottom) {
                footerActions
                    .padding(.horizontal, 20)
                    .padding(.vertical, 12)
                    .background(.ultraThinMaterial)
            }
        }
        .preferredColorScheme(.dark)
    }

    // MARK: - Idle Phase

    private var idleView: some View {
        VStack(spacing: 20) {
            // Quick Actions
            VStack(alignment: .leading, spacing: 10) {
                Text("QUICK ACTIONS")
                    .font(.system(size: 11, weight: .semibold))
                    .tracking(1.2)
                    .foregroundStyle(.secondary)

                LazyVGrid(
                    columns: Array(repeating: .init(.flexible(), spacing: 8), count: 3),
                    spacing: 8
                ) {
                    ForEach(
                        AIPlanEditorViewModel.quickActions,
                        id: \.label
                    ) { action in
                        Button {
                            vm.applyQuickAction(action.prompt)
                        } label: {
                            VStack(spacing: 6) {
                                Image(systemName: action.icon)
                                    .font(.system(size: 16))
                                    .foregroundStyle(.blue)
                                Text(action.label)
                                    .font(.system(size: 10, weight: .medium))
                                    .multilineTextAlignment(.center)
                                    .foregroundStyle(.secondary)
                            }
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 12)
                            .background(.white.opacity(0.04), in: .rect(cornerRadius: 12))
                            .overlay(
                                RoundedRectangle(cornerRadius: 12)
                                    .stroke(.white.opacity(0.06), lineWidth: 1)
                            )
                        }
                        .buttonStyle(.plain)
                    }
                }
            }

            // Instruction Input
            VStack(alignment: .leading, spacing: 8) {
                Text("INSTRUCTION")
                    .font(.system(size: 11, weight: .semibold))
                    .tracking(1.2)
                    .foregroundStyle(.secondary)

                TextField(
                    "e.g., Add a bagel to meal 2 on Mondays",
                    text: $vm.instruction,
                    axis: .vertical
                )
                .lineLimit(2...5)
                .padding(12)
                .background(.white.opacity(0.04), in: .rect(cornerRadius: 12))
                .overlay(
                    RoundedRectangle(cornerRadius: 12)
                        .stroke(.white.opacity(0.1), lineWidth: 1)
                )
                .onSubmit { Task { await vm.submit() } }

                Text("Tap submit or press Return")
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            }
        }
    }

    // MARK: - Thinking Phase

    private var thinkingView: some View {
        VStack(spacing: 16) {
            ProgressView()
                .controlSize(.large)
                .tint(.blue)

            Text("Analyzing your plan...")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.secondary)

            Text("This usually takes a few seconds")
                .font(.caption)
                .foregroundStyle(.tertiary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 60)
    }

    // MARK: - Preview Phase

    private func previewView(summary: String) -> some View {
        VStack(spacing: 16) {
            // Summary banner
            HStack(spacing: 10) {
                Image(systemName: "checkmark.circle.fill")
                    .foregroundStyle(.blue)
                VStack(alignment: .leading, spacing: 2) {
                    Text(summary)
                        .font(.subheadline.weight(.semibold))
                    Text("Review the changes below")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer()
            }
            .padding(12)
            .background(.blue.opacity(0.1), in: .rect(cornerRadius: 12))
            .overlay(
                RoundedRectangle(cornerRadius: 12)
                    .stroke(.blue.opacity(0.2), lineWidth: 1)
            )

            // Change list
            if vm.changes.isEmpty {
                HStack(spacing: 10) {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .foregroundStyle(.yellow)
                    Text("No changes detected. Try a more specific instruction.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                .padding(12)
                .background(.yellow.opacity(0.1), in: .rect(cornerRadius: 12))
            } else {
                VStack(alignment: .leading, spacing: 6) {
                    Text("CHANGES (\(vm.changes.count))")
                        .font(.system(size: 11, weight: .semibold))
                        .tracking(1.2)
                        .foregroundStyle(.secondary)

                    ForEach(vm.changes) { change in
                        ChangeRow(change: change)
                    }
                }
            }

            // Edit instruction
            VStack(alignment: .leading, spacing: 6) {
                Text("Not right? Update your instruction:")
                    .font(.caption)
                    .foregroundStyle(.tertiary)
                TextField("Instruction", text: $vm.instruction, axis: .vertical)
                    .lineLimit(1...3)
                    .padding(10)
                    .background(.white.opacity(0.04), in: .rect(cornerRadius: 10))
                    .overlay(
                        RoundedRectangle(cornerRadius: 10)
                            .stroke(.white.opacity(0.1), lineWidth: 1)
                    )
            }
        }
    }

    // MARK: - Error Phase

    private func errorView(message: String) -> some View {
        VStack(spacing: 16) {
            HStack(spacing: 10) {
                Image(systemName: "xmark.circle.fill")
                    .foregroundStyle(.red)
                VStack(alignment: .leading, spacing: 2) {
                    Text("Something went wrong")
                        .font(.subheadline.weight(.semibold))
                    Text(message)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer()
            }
            .padding(12)
            .background(.red.opacity(0.1), in: .rect(cornerRadius: 12))
            .overlay(
                RoundedRectangle(cornerRadius: 12)
                    .stroke(.red.opacity(0.2), lineWidth: 1)
            )

            TextField("Instruction", text: $vm.instruction, axis: .vertical)
                .lineLimit(1...3)
                .padding(10)
                .background(.white.opacity(0.04), in: .rect(cornerRadius: 10))
                .overlay(
                    RoundedRectangle(cornerRadius: 10)
                        .stroke(.white.opacity(0.1), lineWidth: 1)
                )
        }
    }

    // MARK: - Footer Actions

    @ViewBuilder
    private var footerActions: some View {
        switch vm.phase {
        case .idle:
            Button {
                Task { await vm.submit() }
            } label: {
                Label("Apply AI Edit", systemImage: "sparkles")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .disabled(vm.instruction.trimmingCharacters(
                in: .whitespacesAndNewlines
            ).isEmpty)

        case .thinking:
            Button("Cancel") { vm.reset() }
                .buttonStyle(.bordered)
                .controlSize(.large)
                .frame(maxWidth: .infinity)

        case .preview:
            HStack(spacing: 8) {
                Button("Cancel") { vm.reset() }
                    .buttonStyle(.bordered)
                    .controlSize(.large)

                Button {
                    Task { await vm.submit() }
                } label: {
                    Label("Retry", systemImage: "arrow.counterclockwise")
                }
                .buttonStyle(.bordered)
                .controlSize(.large)

                Button {
                    if let plan = vm.newPlan {
                        onApply(plan)
                        dismiss()
                    }
                } label: {
                    Text("Apply")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .tint(.green)
                .controlSize(.large)
                .disabled(vm.changes.isEmpty)
            }

        case .error:
            HStack(spacing: 8) {
                Button("Cancel") { vm.reset() }
                    .buttonStyle(.bordered)
                    .controlSize(.large)

                Button {
                    Task { await vm.submit() }
                } label: {
                    Label("Try Again", systemImage: "arrow.counterclockwise")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
            }
        }
    }
}

// MARK: - Change Row

struct ChangeRow: View {
    let change: ChangeEntry

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            changeIcon
            VStack(alignment: .leading, spacing: 2) {
                Text(change.label)
                    .font(.subheadline.weight(.medium))
                if let detail = change.detail {
                    Text(detail)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            Spacer()
        }
        .padding(10)
        .background(.white.opacity(0.03), in: .rect(cornerRadius: 10))
        .overlay(
            RoundedRectangle(cornerRadius: 10)
                .stroke(.white.opacity(0.06), lineWidth: 1)
        )
    }

    @ViewBuilder
    private var changeIcon: some View {
        switch change.type {
        case .added:
            Image(systemName: "plus.circle.fill")
                .foregroundStyle(.green)
                .font(.caption)
        case .removed:
            Image(systemName: "minus.circle.fill")
                .foregroundStyle(.red)
                .font(.caption)
        case .modified:
            Image(systemName: "pencil.circle.fill")
                .foregroundStyle(.blue)
                .font(.caption)
        case .info:
            Image(systemName: "info.circle.fill")
                .foregroundStyle(.yellow)
                .font(.caption)
        }
    }
}
```

### Step 6: Integration Point

Present the sheet from your meal plan editor view:

```swift
// In your existing MealPlanEditorView:

@State private var showAIEditor = false

// ... in your toolbar or button area:
Button {
    showAIEditor = true
} label: {
    Label("AI Editor", systemImage: "sparkles")
}
.sheet(isPresented: $showAIEditor) {
    AIPlanEditorSheet(
        vm: AIPlanEditorViewModel(
            currentMeals: convertToAPIMeals(localMeals),
            currentExtras: localExtras,
            currentSupport: localSupportContent
        ),
        onApply: { newPlan in
            // Convert ParsedMealPlan back to your local models
            // and replace the current plan state
            applyModifiedPlan(newPlan)
        }
    )
}
```

---

## UI/UX Specifications

### Quick Action Grid

| Property | Value |
|----------|-------|
| Layout | 3-column grid |
| Card padding | 12pt vertical |
| Card background | `white @ 4% opacity` |
| Card border | `white @ 6% opacity, 1pt` |
| Icon color | `.blue` (SF Symbol) |
| Label size | 10pt medium |
| Hover/press effect | Scale 0.96 + border brightens |

### Color Tokens

| Element | Light (skip) | Dark |
|---------|-------|------|
| Panel background | — | `#0a0e18 @ 95%` + blur |
| Border | — | `white @ 8%` |
| Input bg | — | `white @ 4%` |
| Input border | — | `white @ 10%` |
| Input focus border | — | `blue @ 40%` |
| Primary text | — | `zinc-100` |
| Secondary text | — | `zinc-500` |
| Muted text | — | `zinc-600` |
| Change: added | — | `emerald-400` on `emerald-500/20` bg |
| Change: removed | — | `red-400` on `red-500/20` bg |
| Change: modified | — | `blue-400` on `blue-500/20` bg |
| Change: info | — | `amber-400` on `amber-500/20` bg |
| CTA button | — | `blue-600 → blue-500` gradient |
| Apply button | — | `emerald-600 → emerald-500` gradient |

### Thinking Animation Stages

| Stage | Duration | Icon | Text |
|-------|----------|------|------|
| 1 | 0 – 2.2s | 🔍 | "Analyzing your plan..." |
| 2 | 2.2 – 4.4s | ⚙️ | "Building changes..." |
| 3 | 4.4s+ | ✨ | "Preparing preview..." |

Progress bar: 3 segments, each lights up with `blue → purple` gradient as the stage activates.

---

## Authentication Notes for iOS

The existing web API uses **Clerk session cookies** for auth. For the iOS app, you'll need one of:

1. **Clerk iOS SDK** — Use `@clerk/clerk-expo` or the native Clerk SDK to get a session token, then pass it as a `Bearer` token in the `Authorization` header
2. **Custom JWT** — If you have a custom auth flow, ensure the `/api/mealplans/modify-plan` route can validate it
3. **API Key** — Add an API key validation path to the route for mobile clients

The server-side `getCurrentDbUser()` call needs to resolve the user from whatever auth mechanism the iOS app uses. This may require updating the API route to support `Authorization: Bearer <token>` in addition to cookie-based auth.
