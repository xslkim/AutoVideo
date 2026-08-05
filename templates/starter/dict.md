# Pronunciation dictionary (optional — delete this file if you don't need it)
#
# A cloned Chinese voice reads Latin terms inconsistently: the same acronym can
# come out spelled, transliterated, or mangled depending on its context. Pin the
# reading of such terms here once, and every narration line uses it.
#
# Only the synthesized audio changes — subtitles still show the original text.
#
# Syntax, one rule per line:
#
#   <term>       => <how to read it>
#   /<regex>/i   => <how to read it>      # $1 backreferences work
#
# Literal terms made of ASCII letters only match whole words, so `IMU` does not
# fire inside `IMUX`. Longer terms win over shorter ones. Lines starting with
# `#` are comments.

# IMU        => I M U
# cam0       => cam 零
# ROS 2      => ROS two
# /(\d+)fps/i => $1 帧每秒
