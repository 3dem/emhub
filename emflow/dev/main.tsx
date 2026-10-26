// Dev entry (npm run dev): mounts the viewer from source with the fake service
import { mountProjectPage } from "../src/index";
import { createFakeService } from "./fakeService.js";

mountProjectPage({
  container: "#emflow-host",
  service: createFakeService(),
  projectName: "43",
});
