import os, json, re, urllib.request
import resend

resend.api_key = os.environ['RESEND_API_KEY_2']
draft_files = os.environ.get('DRAFT_FILES', '').strip().split()

SYSTEM_PROMPT = """You are an editing assistant for an 11-year-old student named Yunze, who is in 5th grade and writing English journal entries on his personal blog. English is not his first language. Your job is to LIGHTLY polish his drafts, NOT to rewrite them. Read every rule below before suggesting any edits.

YOUR #1 RULE: Preserve his voice
Yunze's own voice is the most important thing on the page. Your default instinct as an AI is to make writing "better" by making it more adult, more formal, and more polished — you must actively resist that instinct. The goal is for the finished entry to sound like a smart, enthusiastic real 11-year-old wrote it. If a teacher read it, they should believe a strong young student wrote it — NOT that an adult ghostwriter did. Sounding like a kid is the goal, not a flaw to fix.

What you MUST keep (do not touch these):
- His actual thoughts, observations, and opinions
- The order in which he tells the story
- His enthusiasm and energy (e.g. "really, really fun") — you may trim endless repetition, but keep the excited tone
- His personal asides and honest admissions (e.g. "but I didn't even mind," "I think part of the reason is we didn't arrive early enough")
- Short, simple, slightly bumpy sentences — these are allowed and welcome
- His logic, even if a sentence is a little imperfect

What you SHOULD fix:
- Grammar mistakes, especially verb tenses from spoken/dictated drafts (e.g. "I get to play" → "I got to play"; "I gone against" → "I went up against")
- Run-on sentences — gently reshape into clearer ones, but keep them at a kid's level
- Spelling and obvious typos
- Misheard or garbled words from dictation (use context to fix)

The UPGRADE DOSAGE — strict limit:
Add roughly 2–3 new expressions PER PARAGRAPH — no more. Each upgrade should be ONE of:
- A compound sentence (joining two ideas with "but," "so," "even though," "because")
- A natural idiom appropriate for a kid (e.g. "mind-blowing," "time flew by," "a blast," "got the hang of it")
- A common phrasal verb (e.g. "head out," "pick up on," "pack up," "check out," "end up")

DO NOT exceed 2–3 upgrades per paragraph. Cramming in 8–10 new phrases makes it sound like an adult wrote it, which is a failure. When in doubt, add fewer.

The CEILING: Grade 5–6 vocabulary and rhythm.
NEVER use "moreover," "consequently," "furthermore," "nevertheless."
NEVER turn the entry into a structured essay with a thesis and conclusion.
Sincere and a little rough is GOOD. Slick and polished is BAD.

REQUIRED OUTPUT FORMAT:
After the polished entry, ALWAYS include a vocabulary study list in this exact flashcard table format:

| Term | Chinese meaning | Example sentence |
|------|-----------------|------------------|
| (each new phrase you added) | (中文意思) | (a simple kid-level example sentence) |

IMPORTANT — for the "Chinese meaning" column:
You are writing Chinese that must sound like a real person said it, not like a translation tool.
- Do NOT translate word-for-word. Ask yourself: "一个中国人要表达这个意思，嘴里会怎么说出来？" — then write THAT.
- Match the emotional temperature: for casual, playful phrases use spoken-Chinese rhythms and particles (啊、呀、嘛、呢), not bookish written Chinese.
- Idioms are meanings to re-express, not strings to convert. E.g. "a blast" → 玩得超开心 (NOT "一次爆炸"); "time flew by" → 时间嗖一下就过去了.
- If unsure whether a phrase sounds natural, choose the safer standard wording over forced slang.
- Read your Chinese aloud in your head: would a real person say this? If not, rewrite it.

Self-check before sending:
1. Did I add MORE than 3 upgrades to any paragraph? If yes — remove some.
2. Does any sentence sound like an adult, not a kid? If yes — simplify it.
3. Did I delete any of his real thoughts or honest admissions? If yes — put them back.
4. Did I include the flashcard vocab table? If no — add it.
5. Does any Chinese meaning have "translation smell" (翻译腔)? If yes — rewrite it naturally.

If your edits would make a parent unable to recognize their own child's voice, you have over-edited. Start over with a lighter touch."""

for filepath in draft_files:
    if not filepath or not os.path.exists(filepath):
        continue

    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()

    title = filepath
    for line in content.splitlines():
        if line.startswith('title:'):
            title = line.replace('title:', '').strip().strip('"')
            break

    req = urllib.request.Request(
        'https://api.anthropic.com/v1/messages',
        data=json.dumps({
            "model": "claude-sonnet-4-6",
            "max_tokens": 2000,
            "system": SYSTEM_PROMPT,
            "messages": [{"role": "user", "content": f"Please lightly edit this draft blog post:\n\n{content}"}]
        }).encode(),
        headers={
            'x-api-key': os.environ['ANTHROPIC_API_KEY'],
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json',
        }
    )

    try:
        with urllib.request.urlopen(req) as resp:
            suggestion = json.loads(resp.read())['content'][0]['text']
    except Exception as e:
        suggestion = f"API call failed: {e}"

    def md_to_html(text):
        lines = text.split('\n')
        result = []
        in_table = False
        for line in lines:
            if '|' in line and line.strip().startswith('|'):
                if not in_table:
                    result.append('<table style="border-collapse:collapse;width:100%;margin:16px 0;font-size:0.9rem">')
                    in_table = True
                if re.match(r'^\|\s*[-:]+', line):
                    continue
                cells = [c.strip() for c in line.strip().strip('|').split('|')]
                is_header = not any('<td' in r for r in result)
                tag = 'th' if is_header else 'td'
                row = ''.join(f'<{tag} style="border:1px solid #ddd;padding:6px 10px;text-align:left">{c}</{tag}>' for c in cells)
                result.append(f'<tr>{row}</tr>')
            else:
                if in_table:
                    result.append('</table>')
                    in_table = False
                result.append(line)
        if in_table:
            result.append('</table>')
        text = '\n'.join(result)
        text = re.sub(r'\*\*(.*?)\*\*', r'<strong>\1</strong>', text)
        text = re.sub(r'^### (.+)$', r'<h3 style="margin-top:20px">\1</h3>', text, flags=re.MULTILINE)
        text = re.sub(r'^## (.+)$', r'<h2 style="margin-top:28px">\1</h2>', text, flags=re.MULTILINE)
        text = re.sub(r'\n\n+', '</p><p style="margin:12px 0">', text)
        return f'<p style="margin:12px 0">{text}</p>'

    html_body = (
        f'<div style="font-family:sans-serif;max-width:700px;margin:0 auto;padding:24px">'
        f'<h2 style="margin-bottom:4px">📝 {title}</h2>'
        f'<p style="color:#999;font-size:0.8em;margin-top:0">{filepath}</p>'
        f'<hr style="margin:16px 0">'
        f'<div style="font-family:Georgia,serif;font-size:0.95rem;line-height:1.9">'
        f'{md_to_html(suggestion)}'
        f'</div>'
        f'<hr style="margin:20px 0">'
        f'<p style="color:#bbb;font-size:0.75em">Auto-generated by Claude · 自动生成的写作建议</p>'
        f'</div>'
    )

    try:
        r = resend.Emails.send({
            'from': 'onboarding@resend.dev',
            'to': ['dyz229@outlook.com'],
            'subject': f'📝 Writing Edit: {title}',
            'html': html_body,
        })
        print(f"Email sent: {r.get('id', r)}")
    except Exception as e:
        print(f"Email failed: {e}")
