<template>
  <div style="padding: 24px;">
    <h1>项目页 - {{ route.params.name }}</h1>
  </div>
</template>

<script setup lang="ts">
import { useRoute } from 'vue-router';

const route = useRoute();
</script>
