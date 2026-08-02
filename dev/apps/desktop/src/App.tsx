import FirstRunGate from "./components/FirstRunGate";
import JobList from "./components/JobList";
import UrlBatch from "./components/UrlBatch";

function App() {
  return (
    <FirstRunGate>
      <main className="flex h-screen w-screen flex-col items-center gap-6 overflow-y-auto bg-neutral-950 p-8">
        <h1 className="text-4xl font-bold tracking-tight text-white">LiMBo</h1>
        <UrlBatch />
        <JobList />
      </main>
    </FirstRunGate>
  );
}

export default App;
