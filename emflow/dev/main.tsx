// Dev entry (npm run dev): mounts the viewer from source with the fake service
import { mountProjectPage } from "../src/index";
import { createFakeService } from "./fakeService.js";

mountProjectPage({
  container: "#emflow-host",
  service: createFakeService(),
  // ?project=<name>: the fake project as another one (copy / paste between tabs)
  projectName: new URLSearchParams(location.search).get("project") ?? "43",
});
