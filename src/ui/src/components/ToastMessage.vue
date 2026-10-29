<script setup>
defineProps({ text: String })
</script>

<template>
  <Transition name="toast">
    <div class="toast" v-if="text">{{ text }}</div>
  </Transition>
</template>
