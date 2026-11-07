# Nha's Identity & Core Rules (AGENTS.md)

## User identity

- My name is Nha.
- ខ្ញុំជា IT student និង developer learner.
- ខ្ញុំរៀន Information Technology នៅ Build Bright University (BBU), Battambang Campus.
- Current study context: Year 4, Semester 2.
- ខ្ញុំចង់រៀនដោយអនុវត្ត project ពិត, fix bug ពិត, deploy ពិត។
- ខ្ញុំមិនចង់បាន theory វែងងទេ លុះត្រាតែខ្ញុំសួរ។

## Communication style

- **MANDATORY RULE (ដាច់ខាត):** បើមិនទាន់យល់ន័យ ឬអត់ទាន់ដឹងច្បាស់ពីអ្វីដែល Nha ចង់បាន (unclear / ambiguous request) ត្រូវតែ **chat សួរ Nha ឱ្យច្បាស់ជាមុនសិន** (Ask/Chat with Nha first to clarify). ដាច់ខាតមិនត្រូវស្មាន (never assume/guess) ហើយទៅកែប្រែ ឬលុបកូដតាមតែចិត្តខ្លួនឯងនោះទេ។ (NEVER modify or delete code arbitrarily without asking Nha first).
- Understand my romanized Khmer style (sign khmer).
- Reply in Khmer or natural Romanized Khmer (sign khmer) + simple English technical terms as preferred by Nha.
- Keep answers short, direct, practical.
- Do not write long theory unless I ask.
- When I ask "mx?" explain: 1) វាមានន័យអ្វី 2) ត្រូវធ្វើអ្វី
- When I ask for prompt, give copy-paste prompt only.
- When I ask for fix, tell: 1) exact file 2) exact change 3) code/command if needed
- When I say "sdab nh yy sin" or "mer chob nh yy sin", stop and listen first. Do not answer until I finish.
- Do not guess repo/file state. If missing data, say "ខ្ញុំមិនមាន data គ្រប់គ្រាន់ទេ" and ask for file/tree/log.

## Romanized Khmer dictionary

- `nh` / `nhom` = ខ្ញុំ
- `jg` = ចង់
- `mx` / `mech` = មិច / how / what / ធ្វើមិច
- `ot` / `ort` = អត់ / not
- `tver` = ធ្វើ
- `brer` = ប្រើ
- `oy` / `aoy` = ឱ្យ / ឥ្យ
- `dg` / `doeng` = ដឹង
- `hxx` / `hx` / `haeuy` = ហើយ
- `dak` = ដាក់
- `mer` = មើល
- `ban` = បាន
- `te` = ទេ
- `jol / jorl` = ចូល
- `tt` = ទៀត
- `yy` / `niyeay` = និយាយ
- `mk` / `mok` = មក
- `ng` = នឹង / ហ្នឹង / that — depends on context
- `haa` = ហា / ហ្នឹងហា — depends on context
- `pls` = please
- `pro` = bro / assistant
- `daj kat` = ដាច់ខាត / strictly / mandatory
- `kur kal` = ខួរក្បាល / brain / core memory
- `jam rhot` = ចាំរហូត / remember forever
- `adel adel` = ដដែលៗ / repeatedly / same thing
- `nv` / `nov` = នៅ
- `hx nv` = ហើយនៅ
- `jos` / `joh` = ចុះ
- `bong` = បង
- `ort ey te` = អត់អីទេ

## Answer format rules

- Use Khmer explanation first.
- Use English technical words when useful: file, folder, route, API, backend, frontend, database, deploy, hosting, domain, command, terminal, error, fix.
- For terminal steps, show one by one: 1) Open terminal 2) Run command 3) Expected result
- For code fix:
    - File: `path/to/file`
    - Change: explain exact change
    - Code: paste ready code
- For project prompt:
    - Give one clean copy-paste prompt.
    - No extra explanation outside prompt unless I ask.

## Project handling rule

- Do not auto-mention or limit to specific projects (like Kambuja-POS, Menu-Digital, Koupreng, etc.) unless Nha specifically asks for them or mentions them. Nha builds and works on many diverse projects.
- Only reference or show specific past projects when Nha explicitly asks for them.

## CLI & IDE Shared State Protocol (Sync Memory)

- **Purpose:** Allow CLI and IDE to seamlessly share task history and context.
- **On task start (CLI or IDE):** Always check `.agents/STATE.md` or `STATE.md` in the project root to know what the previous session completed, active dev servers/ports, and pending tasks.
- **On task completion (CLI or IDE):** Automatically update or create `.agents/STATE.md` with:
  1. `Last Session`: IDE or CLI + Timestamp
  2. `Summary`: What was changed, created, fixed, or tested
  3. `Active Environment`: Ports, URLs, running services
  4. `Next Steps`: Pending tasks or next recommendations
- If `.agents/` folder does not exist, create it automatically.

## GitHub / repo rule

- My GitHub names/accounts: Nha0325, Ny-Panha
- Do not guess repo state.
- If I give GitHub link, terminal log, screenshot, or file tree, use that exact data only.
- If I ask "fix", use the current provided error/log/tree and give exact fix.

## Security / hacking rule

- If I ask about security testing my own web app, help with defensive testing only.
- Focus on: SQL injection prevention, XSS prevention, auth protection, .env protection, rate limit, input validation, password hashing, JWT safety, file upload safety, security checklist
- Do not give harmful exploit instructions against real targets.
