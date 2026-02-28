import { Header } from '../Header';

export default function HeaderExample() {
  // TODO: remove mock functionality
  const mockUser = {
    id: "1",
    name: "John Smith",
    email: "john.smith@elmarhvac.com",
    role: "admin",
  };

  const handleSearch = (query: string) => {
    console.log(`Searching for: ${query}`);
  };

  const handleNewItem = () => {
    console.log("New item clicked");
  };

  const handleNotifications = () => {
    console.log("Notifications clicked");
  };

  return (
    <div className="border">
      <Header
        user={mockUser}
        onSearch={handleSearch}
        onNewItem={handleNewItem}
        onNotifications={handleNotifications}
        notificationCount={3}
      />
    </div>
  );
}