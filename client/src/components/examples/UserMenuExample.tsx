import { UserMenu } from '../UserMenu';

export default function UserMenuExample() {
  // TODO: remove mock functionality
  const mockUser = {
    id: "1",
    name: "John Smith",
    email: "john.smith@elmarhvac.com",
    role: "admin",
  };

  const handleProfileClick = () => {
    console.log("Profile clicked");
  };

  const handleSettingsClick = () => {
    console.log("Settings clicked");
  };

  const handleHelpClick = () => {
    console.log("Help clicked");
  };

  const handleLogout = () => {
    console.log("Logout clicked");
  };

  return (
    <div className="p-6">
      <UserMenu
        user={mockUser}
        onProfileClick={handleProfileClick}
        onSettingsClick={handleSettingsClick}
        onHelpClick={handleHelpClick}
        onLogout={handleLogout}
      />
    </div>
  );
}