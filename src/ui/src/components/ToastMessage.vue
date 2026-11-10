<script setup>
defineProps({ text: String })
</script>

<template>
  <Transition name="toast"><div class="toast" v-if="text" role="status"><span class="toast-orb" aria-hidden="true"></span><span>{{ text }}</span></div></Transition>
</template>
