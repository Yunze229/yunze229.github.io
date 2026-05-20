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
        "你是一个友善的写作助手，帮助一个10岁的孩子改善他的博客文章。\n"
        "请用简单易懂的语言给出3-5条具体的改进建议，包括：\n"
        "- 内容是否清晰完整\n"
        "- 表达是否准确生动\n"
        "- 有没有可以展开的地方\n"
        "- 结构是否清晰\n\n"
        "用中文回复，语气要鼓励，像朋友一样说话。\n\n"
        "文章内容：\n\n" + content
    )

    req = urllib.request.Request(
        'https://api.anthropic.com/v1/messages',
        data=json.dumps({
            "model": "claude-sonnet-4-6",
            "max_tokens": 1024,
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
        suggestion = f"API 调用失败：{e}"

    suggestion_html = suggestion.replace('\n', '<br>')
    html_body = (
        f'<h2>文件：{filepath}</h2>'
        f'<h3>Claude 的建议</h3>'
        f'<p>{suggestion_html}</p>'
        f'<hr>'
        f'<p><em>这是自动生成的写作建议，仅供参考。</em></p>'
    )

    try:
        r = resend.Emails.send({
            'from': 'onboarding@resend.dev',
            'to': ['dyz229@outlook.com'],
            'subject': f'📝 AI 草稿建议：{title}',
            'html': html_body,
        })
        print(f"Email sent: {r.get('id', r)}")
    except Exception as e:
        print(f"Email failed: {e}")
