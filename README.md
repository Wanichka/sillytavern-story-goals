# Story Goals

Where this story is going, written by hand, for one chat. You set a goal, the story drifts toward it over as many messages as it takes, and you tick it off when it is reached. A ticked goal leaves the prompt at once and stays in the panel, struck through.

Not a task manager. There is no auto-generation, no auto-check, no current task, no progress bar, and — the important part — **no second API request**. The Objective / SuperObjective family sends your chat back to the model under a service prompt to ask whether a task is done, without your preset and without your jailbreak, which is exactly what trips a content filter on an NSFW roleplay. Everything here is local. The only thing that ever reaches the model is the text block below.

```
Найти способ попасть в закрытую секцию библиотеки
  · достать разрешение у преподавателя
  · выяснить график обходов
Помириться с Дафной
```

## Using it

The compass button opens and closes the panel. Drag it anywhere — the position is remembered. The panel drags by its header; its height changes with the strip between the list and the footer (double-click the strip to reset).

| Control              | What it does                                                        |
| -------------------- | ------------------------------------------------------------------- |
| `+` in the header    | new goal                                                            |
| checkbox             | reached / not reached; a reached goal stays in the panel, not in the prompt |
| `+` on a card        | add a step to that goal                                             |
| pencil               | edit the goal or the step                                           |
| `×`                  | delete — goals ask first, steps do not                              |
| search               | filter by goal text or step text                                    |
| gear                 | settings                                                            |
| Export / Import      | JSON file with every goal in this chat                              |
| trash in the footer  | wipe the whole list for this chat                                   |

The header counter reads `active/total · tokens`. Tokens come from your active tokenizer; when it is unavailable, a rough estimate is shown with a `~`.

A goal is one line, so in the editor `Enter` saves, `Shift+Enter` breaks the line and `Escape` cancels. (Story Notes does the opposite, because a note is a paragraph and a goal is a heading.) Pasted line breaks are collapsed rather than rejected.

Steps append to the bottom of their goal — a route is read top to bottom. Ticking a goal does not tick its steps: reopening it later brings back exactly the steps that were still ahead.

## What reaches the model

Unfinished goals, with their unfinished steps, assembled into one block:

```
<story_goals>
Long-term narrative goals for this story, set by the user...
Reference material only...
Do not redirect the current scene toward a goal...
A goal may stay untouched for many messages, and that is correct...

- goal
  · step
- another goal
</story_goals>
```

Finished goals and finished steps are gone from the block completely. There is no "recently completed" section — the chat history already records what happened, and a list of past achievements only teaches the model to narrate the list.

The block is rebuilt on every change and again right before each generation. With no unfinished goals the injection is cleared to an empty string and nothing is sent at all.

## Settings

Global — they describe how the block is delivered, not what is in it.

**Position in the prompt.** Default is before the chat history, next to the summary and the lorebooks. SillyTavern concatenates same-position injections in alphabetical order of their key; Summarize uses `1_memory`, so `story_goals_injection` lands after the summary, where the active-quests tail of a summary naturally continues.

`Depth 4` and `depth 0` place the block inside the history instead. Depth 0 makes the list the last thing the model reads before answering, and it will start executing it: the character walks to the library in the very next post no matter what the scene was doing. That is the failure this extension exists to prevent, so keep depth 0 for the case where the block is being ignored entirely.

`Macro only` disables the injection. The block then reaches the prompt solely where you write `{{story_goals}}` yourself. The macro is registered in every mode, so using it while the injection is on will send the block twice.

**Block preamble.** The instruction above the list, and the whole reason this extension exists. It says three things: goals are direction rather than an order for this turn, the current scene comes first, and leaving a goal untouched for many messages is correct behaviour rather than a failure. Without that last sentence the model reads the presence of an item as a task for the next message. Edit it per model; the button beside it restores the original text.

## Where goals live

Chat metadata is the source of truth — it lives in the chat file on the server, travels with backups and follows a branched chat. localStorage is a warm local mirror and the fallback when metadata is unreachable. The key is per chat, so a new chat starts empty: goals are set for a run, not for a character.

Same scheme as Story Notes and Relationship Memory Tracker, so all three behave identically when chats are switched or branched.

Goals do **not** migrate on their own into a fresh chat for the same AU — that is what export and import are for.

## When something is off

**The model charges at a goal immediately.** Check the position first — depth 0 causes exactly this. If it is already before the chat history, strengthen the preamble: the sentence that permits leaving a goal alone is the one doing the work.

**Goals are ignored.** Confirm the block is actually in the prompt, then try depth 4 before depth 0.

**`{{story_goals}}` renders as literal text.** The console will have a warning: this SillyTavern version does not expose `registerMacro`. Use a prompt position instead.

**Goals vanish after a reload.** Open the console: a `Chat metadata unavailable` warning means the extension is running on localStorage, so goals survive but only in this browser.

**The button is gone.** Most likely dragged past an edge. Clear `story_goals_button_pos` in localStorage and reload.

## localStorage keys

| Key                                               | Contents                     |
| ------------------------------------------------- | ---------------------------- |
| `story_goals_v1::<chatId>`                        | mirror of the chat's goals   |
| `story_goals_settings_v1`                         | language, position, preamble |
| `story_goals_panel_pos`, `story_goals_panel_size` | panel geometry               |
| `story_goals_button_pos`                          | button position              |

## Version

0.1.0
