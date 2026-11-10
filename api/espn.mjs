import { handleEspnRequest } from '../server/espn.mjs'

export default {
  fetch(request) {
    return handleEspnRequest(request.method, new URL(request.url))
  },
}
