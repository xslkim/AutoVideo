# Pronunciation dictionary (optional — delete this file if you don't need it)
#
# A cloned Chinese voice reads Latin terms inconsistently: the same acronym can
# come out spelled, transliterated, or mangled depending on its context. Pin the
# reading of such terms here once, and every narration line uses it.
#
# Only the synthesized audio changes — subtitles still show the original text.
#
# Three layers are merged, most local wins:
#   1. <repo>/dict.global.md        shared via git, covers common tech terms
#   2. ~/.config/autovideo/dict.md  machine-level additions
#   3. this file                    project-specific, overrides the above
#
# Syntax, one rule per line:
#
#   <term>       => <how to read it>
#   /<regex>/i   => <how to read it>      # $1 backreferences work
#
# Literal terms made of ASCII letters only match whole words, so `IMU` does not
# fire inside `IMUX`. Longer terms win over shorter ones. Lines starting with
# `#` are comments.
#
# `compile` prints suggestions for suspicious terms this file doesn't cover;
# `autovideo dict suggest` asks an LLM for the ones heuristics can't guess.

# IMU        => I M U
# cam0       => cam 零
# ROS 2      => ROS two
