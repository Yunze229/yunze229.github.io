<?xml version="1.0" encoding="utf-8"?>
<xsl:stylesheet version="3.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:atom="http://www.w3.org/2005/Atom">
  <xsl:output method="html" version="1.0" encoding="UTF-8" indent="yes"/>
  <xsl:template match="/">
    <html lang="zh">
      <head>
        <meta charset="UTF-8"/>
        <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
        <title><xsl:value-of select="/rss/channel/title"/> · RSS</title>
        <style>
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f9f8f6; color: #2a2a2a; padding: 40px 20px; }
          .container { max-width: 640px; margin: 0 auto; }
          .header { margin-bottom: 32px; padding-bottom: 24px; border-bottom: 1px solid #e8e6e2; }
          .header h1 { font-size: 1.5rem; font-weight: 600; margin-bottom: 6px; }
          .header p { color: #888; font-size: 0.9rem; line-height: 1.6; }
          .rss-badge { display: inline-flex; align-items: center; gap: 6px; margin-top: 12px; padding: 6px 12px; background: #e07b54; color: #fff; border-radius: 6px; font-size: 0.8rem; font-weight: 500; text-decoration: none; }
          .rss-badge svg { flex-shrink: 0; }
          .hint { margin-top: 16px; padding: 12px 16px; background: #fff; border: 1px solid #e8e6e2; border-radius: 8px; font-size: 0.85rem; color: #666; line-height: 1.6; }
          .hint strong { color: #2a2a2a; }
          .items { display: flex; flex-direction: column; gap: 16px; }
          .item { background: #fff; border: 1px solid #e8e6e2; border-radius: 10px; padding: 20px 24px; }
          .item-title { font-size: 1rem; font-weight: 600; margin-bottom: 6px; }
          .item-title a { color: #2a2a2a; text-decoration: none; }
          .item-title a:hover { color: #e07b54; }
          .item-date { font-size: 0.8rem; color: #aaa; margin-bottom: 10px; }
          .item-desc { font-size: 0.88rem; color: #666; line-height: 1.7; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1><xsl:value-of select="/rss/channel/title"/> · 订阅源</h1>
            <p><xsl:value-of select="/rss/channel/description"/></p>
            <a class="rss-badge" href="{/rss/channel/link}">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M4 11a9 9 0 0 1 9 9"/><path d="M4 4a16 16 0 0 1 16 16"/><circle cx="5" cy="19" r="1" fill="currentColor" stroke="none"/></svg>
              RSS 订阅源
            </a>
            <div class="hint">
              复制地址栏链接，粘贴到 <strong>Reeder</strong>、<strong>Feedly</strong> 等 RSS 阅读器，即可订阅新文章通知。
            </div>
          </div>
          <div class="items">
            <xsl:for-each select="/rss/channel/item">
              <div class="item">
                <div class="item-title">
                  <a href="{link}"><xsl:value-of select="title"/></a>
                </div>
                <div class="item-date"><xsl:value-of select="pubDate"/></div>
                <div class="item-desc"><xsl:value-of select="description" disable-output-escaping="yes"/></div>
              </div>
            </xsl:for-each>
          </div>
        </div>
      </body>
    </html>
  </xsl:template>
</xsl:stylesheet>
