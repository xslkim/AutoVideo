# AutoVideo — 全局发音词典（仓库级）
#
# 通过 git 分发给所有项目；项目 dict.md 里的同名条目会覆盖这里的条目。
# 机器级补充放 ~/.config/autovideo/dict.md。
#
# 语法：
#   <term>       => <读法>
#   /<regex>/i   => <读法>      # 支持 $1 反向引用
# ASCII 字面量整词匹配，长词优先。

# ── 结构性正则：一点规则覆盖一整类 ──────────────────────────────
# X.cpp / X.ts / X.vue 这类文件名，点号不要读成「点」
/([A-Za-z][A-Za-z0-9]*)\.cpp\b/gi  => $1 C plus plus
/([A-Za-z][A-Za-z0-9]*)\.py\b/gi   => $1 py
/([A-Za-z][A-Za-z0-9]*)\.vue\b/gi  => $1 view
/([A-Za-z][A-Za-z0-9]*)\.ts\b/gi   => $1 T S
/([A-Za-z][A-Za-z0-9]*)\.js\b/gi   => $1 J S
# 量化/版本串：Q4_K_M → Q 4 K M（字母、数字、下划线分段逐段读）
/([A-Z])(\d)_([A-Z])_([A-Z])\b/g => $1 $2 $3 $4
/([A-Z])(\d)_([A-Z])\b/g         => $1 $2 $3
# 单位
/(\d+)\s?fps/gi => $1 帧每秒
/(\d+)\s?Hz/gi  => $1 赫兹
/(\d+)\s?ms\b/gi => $1 毫秒
/(\d+)\s?GB\b/gi => $1 G B
/(\d+)\s?MB\b/gi => $1 M B

# ── 硬件 / 系统 ─────────────────────────────────────────────────
GPU        => G P U
CPU        => C P U
CUDA       => C U D A
VRAM       => V R A M
RAM        => R A M
SSD        => S S D
TPU        => T P U
NPU        => N P U
NUMA       => N U M A
SIMD       => S I M D
AVX        => A V X
GGML       => G G M L
RTX        => R T X
NVIDIA     => N V I D I A
AMD        => A M D
PyTorch    => Py Torch
TensorFlow => Tensor Flow

# ── 协议 / 格式 ─────────────────────────────────────────────────
HTTP       => H T T P
HTTPS      => H T T P S
TCP        => T C P
UDP        => U D P
SSH        => S S H
DNS        => D N S
URL        => U R L
URI        => U R I
JSON       => J S O N
YAML       => Y A M L
XML        => X M L
HTML       => H T M L
CSS        => C S S
SQL        => S Q L
JWT        => J W T
OAuth      => O Auth
gRPC       => G R P C
WebSocket  => Web Socket

# ── AI / 模型 ───────────────────────────────────────────────────
LLM        => L L M
VLM        => V L M
KV Cache   => K V cache
vLLM       => V L L M
GPT        => G P T
LoRA       => Lo R A
QLoRA      => Q Lo R A
MoE        => M O E
RAG        => R A G
FP16       => F P 16
FP8        => F P 8
INT8       => I N T 8
INT4       => I N T 4
BF16       => B F 16

# ── 工程 / 工具 ─────────────────────────────────────────────────
API        => A P I
SDK        => S D K
IDE        => I D E
CLI        => C L I
GUI        => G U I
CI         => C I
CD         => C D
PDF        => P D F
UI         => U I
JSONL      => J S O N L
CICD       => C I C D

# ── 品牌（不按拼写读的才收，按拼写能读的让引擎自己处理）─────────────
OpenAI     => Open A I
Ollama     => Oh llama
llama.cpp  => llama C plus plus
/\bubuntu\b/gi => 乌班图
