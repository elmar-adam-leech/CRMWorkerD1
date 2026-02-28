import { LoginForm } from '../LoginForm';
import { useState } from 'react';

export default function LoginFormExample() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  const handleLogin = (credentials: { username: string; password: string; tenant: string }) => {
    console.log("Login attempt:", credentials);
    setIsLoading(true);
    setError("");
    
    // TODO: remove mock functionality
    setTimeout(() => {
      setIsLoading(false);
      if (credentials.username === "demo" && credentials.password === "demo") {
        console.log("Login successful");
      } else {
        setError("Invalid credentials. Try demo/demo");
      }
    }, 1000);
  };

  return (
    <LoginForm
      onLogin={handleLogin}
      isLoading={isLoading}
      error={error}
    />
  );
}