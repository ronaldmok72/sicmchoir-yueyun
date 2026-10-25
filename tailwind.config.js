// 样式表 tailwind.css 是照这里做出来的（以前每一页开的时候才在手机上现场做，打开会慢）
// 改了网页／src 里的样式（class）之后要重做一次：npm run css
module.exports = {
  content: ['./*.html', './src/**/*.js'],
  // 程式里拼出来的颜色（checkin.js 的 text-${tone}-700）扫不到，要列出来
  safelist: [{ pattern: /^text-(slate|amber|emerald|red|indigo)-700$/ }],
};
