<template>
  <div class="content">
    <div class="login-ui">
      <div class="login-ui-logo">
        <vAppLogo />
      </div>
      <div class="login-button">
        <div class="steam-login" @click="SteamLogin">
          <div class="steam-logo">
            <i class="fas fa-spinner fa-spin fa-pulse" v-if="loading"></i>
            <i class="fab fa-steam" v-else></i>
          </div>
          <span class="steam-login-text">
            {{ loading ? "Connecting to Steam..." : "Connect with Steam" }}
          </span>
        </div>
      </div>
      <p class="login-hint">
        Rooms are hosted over Steam. Keep Steam running; you need to own Noita on this account.
      </p>
    </div>
  </div>
</template>

<script>
import vAppLogo from "../components/vAppLogo.vue"
export default {
  components: { vAppLogo },
  beforeCreate() {
    const unsub = this.$store.subscribe((mutation, state) => {
      if (mutation.type == "setUser" && state.user.id) {
        unsub()
        this.$router.replace({ path: "/lobby" })
        this.$store.commit("setLoading", false)
      }
    })
  },
  mounted() {
    // nothing to type in: try straight away, the button is there for retries
    this.SteamLogin()
  },
  computed: {
    loading() {
      return this.$store.state.loading
    }
  },
  methods: {
    SteamLogin() {
      if (this.loading) return
      this.$store.dispatch("steamLogin")
    }
  }
}
</script>

<style>
.login-ui {
  margin: auto;
}

.login-ui i {
  font-size: 1.5rem;
}

.login-button {
  display: flex;
  margin-top: auto;
  align-self: center;
  cursor: pointer;
  margin: 1em;
}

.login-ui-logo {
  margin-bottom: 2rem;
}

.steam-login {
  display: flex;
  min-width: 300px;
  background-color: #1b2838;
  margin-top: auto;
  align-self: center;
  cursor: pointer;
}

.steam-login:hover {
  background-color: #2a475e;
}

.steam-logo {
  padding: 1rem;
  background-color: #171a21;
}

.steam-login-text {
  margin: auto;
  align-self: center;
}

.login-hint {
  max-width: 300px;
  margin: 0 auto;
  text-align: center;
  font-size: 0.85rem;
  opacity: 0.7;
}
</style>
