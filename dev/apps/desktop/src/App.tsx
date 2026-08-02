import FirstRunGate from "./components/FirstRunGate";
import JobList from "./components/JobList";

function App() {
  return (
    <FirstRunGate>
      <main className="flex h-screen w-screen flex-col items-center gap-8 overflow-y-auto bg-neutral-950 p-8">
        <h1 className="text-4xl font-bold tracking-tight text-white">LiMBo</h1>
        <JobList />
      </main>
    </FirstRunGate>
  );
}

export default App;
