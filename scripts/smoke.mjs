/**
 * Manual smoke test: card rendering + live news. Run with `node scripts/smoke.mjs`.
 */
import { renderCard } from '../lib/cards.js'
import { fetchLatestNews } from '../lib/news.js'

const card = {
  badge: '试炼攻略',
  title: '警察局 · 杀死告密者',
  subtitle: 'Police Station · Kill the Snitch · 建议等级 1+',
  sections: [
    { heading: '主目标', lines: ['- 找到并抓住告密者', '- 把他拖进刑讯室绑上电椅', '- 拉动电闸处决目标'] },
    { heading: '路线要点', lines: ['- 从更衣室右手边走廊推进，先在洗衣房找钥匙卡', '- 刑讯室门口的守卫可以绕开，别硬刚'] },
    { heading: '注意', lines: ['- 利兰·科伊尔会在中段巡逻，听到电击棍充电声立刻躲进柜子'] },
  ],
  footer: '资料来自社区攻略整理，以游戏内实际为准 · dsh-plugin-outlast',
}

const options = { withBanner: process.argv.includes('--banner') }
const result = await renderCard(card, options)
console.log('CARD', JSON.stringify(result))

const news = await fetchLatestNews(3)
console.log('NEWS live=%s error=%s', news.live, news.error || '-')
for (const item of news.items) console.log(' -', item.date, '|', item.titleZh || item.titleEn, '|', item.url)
