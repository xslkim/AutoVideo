>>> 片头 #B01
@enter: fade-up
@exit: fade
@visual: animation

标题页：主标题『为什么是 epoll？』，副标题『高并发网络的底层逻辑：从事件驱动到 Asio』


>>> 高并发的真问题 #B02
@enter: fade-up
@exit: fade
@visual: animation

全屏深色背景 (#0d1117) 填满整个画面，覆盖 width × height 全部区域。
顶部居中标题「10,000 个连接，此刻谁有数据？」，字号 72px，粗体，白色 (#e6edf3)，距顶 70px，高 90px。
标题下方 60px 处是一个 20×20 的圆点网格（400 个圆点，每个代表 25 个连接，合起来代表一万个连接），
网格总宽约 1200px，水平居中，每个圆点直径 26px，点间距 18px，默认颜色 #30363d。
其中固定 4 个圆点（分散在网格不同位置）是 accent 色 (#58a6ff)，带呼吸闪烁动画，表示"有数据来了的连接"。
网格下方 50px 处一行说明文字「靠猜是猜不出来的，必须有人来通知你」，字号 34px，颜色 #8b949e，居中。
说明文字底边距画面底部 ≥ 160px，避让字幕区。
动画跟随旁白推进（用 props.lineTimings 驱动，不硬编码时间戳）：
第 1-2 行只有标题淡入；讲到"一万个客户端连接"（第 2 行）时 400 个灰色圆点按从左到右、从上到下依次点亮出现；
讲到"哪几个有数据来了"（第 4 行）时 4 个蓝色圆点开始闪烁；之后保持。


>>> 两种笨办法 #B03
@enter: fade-up
@exit: fade
@visual: html

<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: 1920px; height: 1080px;
    background: #0d1117;
    font-family: "Noto Sans SC", "Noto Sans", sans-serif;
    color: #e6edf3;
    display: flex; flex-direction: column; align-items: center;
  }
  h1 { margin-top: 80px; font-size: 68px; font-weight: 700; }
  .sub { margin-top: 20px; font-size: 32px; color: #8b949e; }
  .cards {
    margin-top: 70px;
    display: flex; gap: 64px;
    width: 1720px; justify-content: center;
  }
  .card {
    flex: 1;
    background: #161b22;
    border: 2px solid #30363d;
    border-radius: 20px;
    padding: 44px 44px 40px;
  }
  .badge {
    display: inline-block;
    font-size: 26px; color: #0d1117;
    background: #f85149;
    border-radius: 999px;
    padding: 8px 24px; font-weight: 700;
  }
  .name { margin-top: 24px; font-size: 46px; font-weight: 700; }
  .name small { font-size: 28px; color: #8b949e; font-weight: 400; margin-left: 12px; }
  ul { margin-top: 28px; list-style: none; }
  li {
    font-size: 30px; color: #c9d1d9; line-height: 1.5;
    padding: 12px 0 12px 36px; position: relative;
    border-top: 1px dashed #30363d;
  }
  li::before {
    content: "✗"; position: absolute; left: 0;
    color: #f85149; font-weight: 700;
  }
  li b { color: #f85149; }
</style>
</head>
<body>
  <h1>epoll 之前的两种笨办法</h1>
  <div class="sub">目标只有一个：知道一万个连接里，谁有数据来了</div>
  <div class="cards">
    <div class="card">
      <span class="badge">办法一 · 同步阻塞</span>
      <div class="name">一桌一服务员<small>每连接一个线程</small></div>
      <ul>
        <li>来一个连接，开一个线程专门盯着</li>
        <li>1 万连接 = <b>1 万个线程</b></li>
        <li>内存占用 + 上下文切换，直接压垮系统</li>
      </ul>
    </div>
    <div class="card">
      <span class="badge">办法二 · 轮询</span>
      <div class="name">每隔一秒扫全场<small>单线程挨个问</small></div>
      <ul>
        <li>循环问每个 socket：有数据吗？</li>
        <li>1 万个里只有 1 个有动静</li>
        <li><b>9999 次询问全是空转</b>，CPU 烧在无用功上</li>
      </ul>
    </div>
  </div>
</body>
</html>


>>> select 和 poll 的致命伤 #B04
@enter: fade-up
@exit: fade
@visual: html

<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: 1920px; height: 1080px;
    background: #0d1117;
    font-family: "Noto Sans SC", "Noto Sans", sans-serif;
    color: #e6edf3;
    display: flex; flex-direction: column; align-items: center;
  }
  h1 { margin-top: 80px; font-size: 68px; font-weight: 700; }
  h1 span {
    font-family: "JetBrains Mono", monospace;
    color: #58a6ff;
  }
  .sub { margin-top: 20px; font-size: 32px; color: #8b949e; }
  .rows {
    margin-top: 64px;
    width: 1600px;
    display: flex; flex-direction: column; gap: 36px;
  }
  .row {
    display: flex; align-items: center;
    background: #161b22;
    border: 2px solid #30363d;
    border-radius: 18px;
    padding: 34px 44px;
  }
  .num {
    flex: 0 0 88px; height: 88px;
    border-radius: 50%;
    background: #f85149; color: #0d1117;
    font-size: 44px; font-weight: 800;
    display: flex; align-items: center; justify-content: center;
  }
  .txt { margin-left: 40px; }
  .txt .t { font-size: 40px; font-weight: 700; }
  .txt .t b { color: #f85149; }
  .txt .d { margin-top: 10px; font-size: 28px; color: #8b949e; }
  .foot { margin-top: 60px; font-size: 34px; color: #e6edf3; }
  .foot b { color: #f85149; }
</style>
</head>
<body>
  <h1><span>select / poll</span> 的两个半致命伤</h1>
  <div class="sub">它们让一个线程能盯多个连接，但代价巨大</div>
  <div class="rows">
    <div class="row">
      <div class="num">1</div>
      <div class="txt">
        <div class="t">数量上限：<b>select 最多监听 1024 个连接</b></div>
        <div class="d">FD_SETSIZE 写死在内核里，直接卡死并发规模</div>
      </div>
    </div>
    <div class="row">
      <div class="num">2</div>
      <div class="txt">
        <div class="t">全量拷贝：<b>每次调用都把全部连接列表拷进内核</b></div>
        <div class="d">一万个连接就拷一万份，用户态到内核态来回搬运</div>
      </div>
    </div>
    <div class="row">
      <div class="num">3</div>
      <div class="txt">
        <div class="t">逐个遍历：<b>返回后还要 O(n) 扫描才知道谁就绪</b></div>
        <div class="d">活跃连接只有几个，也要把一万个全部检查一遍</div>
      </div>
    </div>
  </div>
  <div class="foot">结论：连接越多，开销越大，<b>性能随连接数直线下降</b></div>
</body>
</html>


>>> epoll 的事件驱动 #B05
@enter: fade-up
@exit: fade
@visual: animation

流程图：新连接接入 → 注册进监控池 → 数据到达按铃 → 只处理响铃的，各节点一句话说明：
① 新连接接入 —— 客户端连上服务器
② 注册进监控池 —— 登记后线程立刻离开
③ 数据到达按铃 —— 内核把连接标记为就绪
④ 只处理响铃的 —— 没动静的一次都不看
流程高亮跟随旁白推进：第 1 行四个节点整体淡入；
第 2 行高亮节点 ①②，第 3 行高亮节点 ③，第 4-5 行高亮节点 ④，
讲到哪一步对应节点高亮放大、其余变暗，用 props.lineTimings 驱动，平滑过渡。


>>> 三个核心函数 #B06
@enter: fade-up
@exit: fade
@visual: animation

代码面板：语言 c，代码如下：
```c
// 1. 创建监控池（安装叫号系统）
int epfd = epoll_create(1024);

// 2. 把 socket 注册进池子（客人领进门）
epoll_ctl(epfd, EPOLL_CTL_ADD, sockfd, &ev);

// 3. 阻塞等待：只返回有数据的连接（铃响才去）
int n = epoll_wait(epfd, events, MAX, -1);
for (int i = 0; i < n; i++) {
    read(events[i].data.fd, buf, sizeof(buf));
}
```
逐段高亮跟随旁白推进：旁白第 1 行展示完整代码；
第 2 行高亮 epoll_create 段，第 3 行高亮 epoll_ctl 段，
第 4-5 行高亮 epoll_wait 与 for 循环段，
用 props.lineTimings 驱动，高亮段保持明亮、其余代码变暗。


>>> 为什么快：关键不是红黑树 #B07
@enter: fade-up
@exit: fade
@visual: animation

要点列表：3 条，每条标题+一句话详情：
① 状态留在内核 —— 监控列表只注册一次，不再每次全量拷贝
② 数据到了先记账 —— 协议栈触发回调，把连接挂进就绪链表
③ 等待只取账单 —— 只返回就绪的几个，开销与总连接数脱钩
要点高亮跟随旁白推进：第 1-2 行为开场，三条要点依次淡入；
第 3 行强调"对比 select 的重复拷贝"（第 ① 条变红闪烁一次后恢复）；
第 4 行高亮第 ② 条，第 5-6 行高亮第 ③ 条并放大强调，
用 props.lineTimings 驱动，平滑过渡。


>>> 你写的回调和 epoll 有啥区别 #B08
@enter: fade-up
@exit: fade
@visual: html

<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: 1920px; height: 1080px;
    background: #0d1117;
    font-family: "Noto Sans SC", "Noto Sans", sans-serif;
    color: #e6edf3;
    display: flex; flex-direction: column; align-items: center;
  }
  h1 { margin-top: 76px; font-size: 66px; font-weight: 700; }
  .sub { margin-top: 18px; font-size: 32px; color: #8b949e; }
  .sub b { color: #58a6ff; }
  .cards {
    margin-top: 60px;
    display: flex; gap: 64px;
    width: 1720px; justify-content: center;
  }
  .card {
    flex: 1;
    background: #161b22;
    border: 2px solid #30363d;
    border-radius: 20px;
    padding: 40px 44px 36px;
  }
  .card.k { border-color: #58a6ff; box-shadow: 0 0 40px rgba(88,166,255,0.22); }
  .mode { font-size: 44px; font-weight: 800; }
  .mode small { font-size: 28px; color: #8b949e; font-weight: 400; margin-left: 14px; }
  .card.k .mode { color: #58a6ff; }
  ul { margin-top: 26px; list-style: none; }
  li {
    font-size: 29px; color: #c9d1d9; line-height: 1.5;
    padding: 12px 0 12px 34px; position: relative;
    border-top: 1px dashed #30363d;
  }
  li::before { content: "•"; position: absolute; left: 4px; color: #58a6ff; }
  li b { color: #e6edf3; }
  .foot { margin-top: 52px; font-size: 36px; color: #e6edf3; }
  .foot b { color: #58a6ff; }
</style>
</head>
<body>
  <h1>都是事件驱动，区别在哪？</h1>
  <div class="sub">区别不在思想，在于<b>事件源在谁手里</b></div>
  <div class="cards">
    <div class="card">
      <div class="mode">你项目里的回调<small>应用层</small></div>
      <ul>
        <li>事件由<b>你自己</b>产生和派发</li>
        <li>定时器、消息队列、UI 点击……状态就在你进程里</li>
        <li>想什么时候看什么状态，随时能看</li>
      </ul>
    </div>
    <div class="card k">
      <div class="mode">网络 IO 的特殊性<small>内核态</small></div>
      <ul>
        <li>「socket 有没有数据」藏在<b>内核协议栈</b>里</li>
        <li>用户态看不见，只能靠系统调用去问</li>
        <li>问法只有三种：<b>阻塞死等 / 轮番询问 / 内核通知</b></li>
      </ul>
    </div>
  </div>
  <div class="foot">epoll 不取代你的事件循环，它是这个循环的<b>事件源</b></div>
</body>
</html>


>>> LT 与 ET 两种触发模式 #B09
@enter: fade-up
@exit: fade
@visual: html

<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: 1920px; height: 1080px;
    background: #0d1117;
    font-family: "Noto Sans SC", "Noto Sans", sans-serif;
    color: #e6edf3;
    display: flex; flex-direction: column; align-items: center;
  }
  h1 { margin-top: 76px; font-size: 66px; font-weight: 700; }
  .sub { margin-top: 18px; font-size: 32px; color: #8b949e; }
  .cards {
    margin-top: 60px;
    display: flex; gap: 64px;
    width: 1720px; justify-content: center;
  }
  .card {
    flex: 1;
    background: #161b22;
    border: 2px solid #30363d;
    border-radius: 20px;
    padding: 40px 44px 36px;
  }
  .card.et { border-color: #58a6ff; box-shadow: 0 0 40px rgba(88,166,255,0.22); }
  .mode {
    font-size: 52px; font-weight: 800;
    font-family: "JetBrains Mono", monospace;
  }
  .mode small { font-size: 30px; color: #8b949e; font-family: "Noto Sans SC", sans-serif; font-weight: 400; margin-left: 14px; }
  .card.et .mode { color: #58a6ff; }
  .motto {
    margin-top: 18px;
    font-size: 34px; font-weight: 700; color: #e6edf3;
  }
  ul { margin-top: 24px; list-style: none; }
  li {
    font-size: 29px; color: #c9d1d9; line-height: 1.5;
    padding: 10px 0 10px 34px; position: relative;
    border-top: 1px dashed #30363d;
  }
  li::before { content: "•"; position: absolute; left: 4px; color: #58a6ff; }
  li b { color: #e6edf3; }
  li .warn { color: #f85149; font-weight: 700; }
  .foot { margin-top: 52px; font-size: 34px; color: #e6edf3; }
  .foot b { color: #58a6ff; }
</style>
</head>
<body>
  <h1>两大杀手锏：LT 与 ET</h1>
  <div class="sub">数据到了之后，epoll 用哪种方式提醒你</div>
  <div class="cards">
    <div class="card">
      <div class="mode">LT<small>水平触发 · 默认模式</small></div>
      <div class="motto">「提醒到你记住为止」</div>
      <ul>
        <li>数据没读完，就<b>一遍一遍重复通知</b>你</li>
        <li>安全省心，不容易出错</li>
        <li>代价：重复通知带来额外开销</li>
      </ul>
    </div>
    <div class="card et">
      <div class="mode">ET<small>边缘触发 · 高效模式</small></div>
      <div class="motto">「只提醒一次」</div>
      <ul>
        <li>必须<b>配合非阻塞 IO，一次性把数据读完</b></li>
        <li>没读完的部分不再提醒，直到新数据到来</li>
        <li><span class="warn">性能极致，但编程难度大、容易丢数据</span></li>
      </ul>
    </div>
  </div>
  <div class="foot"><b>Nginx、Redis</b> 等高并发组件，默认都用 ET 模式榨干性能</div>
</body>
</html>


>>> Windows 和 macOS 上的同类机制 #B10
@enter: fade-up
@exit: fade
@visual: html

<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: 1920px; height: 1080px;
    background: #0d1117;
    font-family: "Noto Sans SC", "Noto Sans", sans-serif;
    color: #e6edf3;
    display: flex; flex-direction: column; align-items: center;
  }
  h1 { margin-top: 80px; font-size: 70px; font-weight: 700; }
  .sub { margin-top: 20px; font-size: 32px; color: #8b949e; }
  .cards {
    margin-top: 76px;
    display: flex; gap: 56px;
    width: 1720px; justify-content: center;
  }
  .card {
    flex: 1;
    background: #161b22;
    border: 2px solid #30363d;
    border-radius: 20px;
    padding: 44px 36px;
    text-align: center;
  }
  .card.hero {
    border-color: #58a6ff;
    box-shadow: 0 0 40px rgba(88,166,255,0.25);
  }
  .os { font-size: 42px; font-weight: 700; color: #8b949e; }
  .card.hero .os { color: #e6edf3; }
  .mech {
    margin-top: 26px;
    font-size: 60px; font-weight: 800;
    font-family: "JetBrains Mono", monospace;
    color: #8b949e;
  }
  .card.hero .mech { color: #58a6ff; }
  .model {
    margin-top: 24px;
    font-size: 27px; line-height: 1.5; color: #c9d1d9;
  }
  .model b { color: #e6edf3; }
  .card.hero .model b { color: #58a6ff; }
  .foot { margin-top: 64px; font-size: 32px; color: #8b949e; }
  .foot b { color: #e6edf3; }
</style>
</head>
<body>
  <h1>同一个思想，三个名字</h1>
  <div class="sub">内核级事件通知，每个操作系统都有自己的实现</div>
  <div class="cards">
    <div class="card hero">
      <div class="os">Linux</div>
      <div class="mech">epoll</div>
      <div class="model"><b>Reactor</b>：告诉你「可以读了」<br>读数据这一步你自己做</div>
    </div>
    <div class="card">
      <div class="os">macOS / BSD</div>
      <div class="mech">kqueue</div>
      <div class="model"><b>Reactor</b>：与 epoll 同型<br>通用性更强的鼻祖</div>
    </div>
    <div class="card">
      <div class="os">Windows</div>
      <div class="mech">IOCP</div>
      <div class="model"><b>Proactor</b>：内核<b>读完了</b>才通知你<br>连「读」这一步都省了</div>
    </div>
  </div>
  <div class="foot">思想一样：<b>内核盯连接，应用只处理就绪事件</b></div>
</body>
</html>


>>> Asio：站在 epoll 肩膀上 #B11
@enter: fade-up
@exit: fade
@visual: animation

流程图（从上到下四层纵向堆叠，层间用向下箭头连接）：你的回调代码 → Asio 事件循环 → 系统机制 → 内核协议栈，各层一句话说明：
① 你的回调代码 —— async_read 注册处理函数
② Asio 事件循环 —— io_context.run 派发事件
③ 系统机制 —— Linux 用 epoll，macOS 用 kqueue，Windows 用 IOCP
④ 内核协议栈 —— 数据到达，标记就绪
层高亮跟随旁白推进：第 1-2 行四层整体淡入；
第 3 行高亮第 ①② 层，第 4 行高亮第 ③ 层（突出显示 epoll 字样），
第 5 行第 ③ 层内循环高亮 kqueue 和 IOCP 字样，第 6 行四层全亮，
用 props.lineTimings 驱动，平滑过渡。
所有层底边距画面底部 ≥ 120px，避让字幕区；背景 #0d1117 填满全屏。


>>> 总结 #B12
@enter: fade-up
@exit: fade
@visual: animation

要点列表：4 条，每条标题+一句话详情：
① 解决什么问题 —— 一万个连接里「谁有数据」的通知问题
② 为什么快 —— 状态留在内核，开销只看活跃连接数
③ 和你的回调啥关系 —— 事件循环照旧，epoll 只是事件源
④ 实际怎么用 —— 直接用 Asio 这类库，自动站在 epoll 上
要点高亮跟随旁白推进：第 1 行开场，四条要点依次淡入；
第 2 行高亮第 ① 条，第 3 行高亮第 ② 条，第 4 行高亮第 ③ 条，第 5 行高亮第 ④ 条，
用 props.lineTimings 驱动，平滑过渡。
