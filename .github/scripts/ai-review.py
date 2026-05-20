import os, json, urllib.request
import resend

resend.api_key = os.environ['RESEND_API_KEY_2']
draft_files = os.environ.get('DRAFT_FILES', '').strip().split()

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

    prompt = (
        "You are a friendly writing coach helping a 10-year-old improve his blog post.\n"
        "Please give 3-5 specific, actionable suggestions covering:\n"
        "- Is the content clear and complete?\n"
        "- Is the expression vivid and accurate?\n"
        "- Are there areas that could be expanded?\n"
        "- Is the structure logical?\n\n"
        "Reply in BOTH Chinese and English. Use an encouraging, friendly tone.\n"
        "Format your response like this:\n\n"
        "**中文建议**\n"
        "1. ...\n"
        "2. ...\n\n"
        "**English Suggestions**\n"
        "1. ...\n"
        "2. ...\n\n"
        "Article content:\n\n" + content
    )

    req = urllib.request.Request(
        'https://api.anthropic.com/v1/messages',
        data=json.dumps({
            "model": "claude-sonnet-4-6",
            "max_tokens": 1500,
            "messages": [{"role": "user", "content": prompt}]
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
        suggestion = f"API 调用失败 / API call failed: {e}"

    suggestion_html = suggestion.replace('\n', '<br>').replace('**', '<strong>', 1)
    # Bold markdown
    import re
    suggestion_html = re.sub(r'\*\*(.*?)\*\*', r'<strong>\1</strong>', suggestion.replace('\n', '<br>'))

    html_body = (
        f'<h2>{title}</h2>'
        f'<p style="color:#888;font-size:0.85em">{filepath}</p>'
        f'<hr>'
        f'<div style="line-height:1.8;font-size:0.95rem">{suggestion_html}</div>'
        f'<hr>'
        f'<p style="color:#aaa;font-size:0.8em">Auto-generated writing suggestions · 自动生成的写作建议</p>'
    )

    try:
        r = resend.Emails.send({
            'from': 'onboarding@resend.dev',
            'to': ['dyz229@outlook.com'],
            'subject': f'📝 Writing Suggestions / 写作建议：{title}',
            'html': html_body,
        })
        print(f"Email sent: {r.get('id', r)}")
    except Exception as e:
        print(f"Email failed: {e}")
