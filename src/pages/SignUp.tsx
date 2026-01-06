import { Mail, Lock, User, UserCircle, ArrowLeft, Loader2 } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";
import { useToast } from "~/hooks/ToastContext";
import { logger } from "~/utils/logger";
import { API_BASE_URL, API_ENDPOINTS } from "~/config/constants";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { cn } from "~/lib/utils";

interface ValidationErrors {
  username?: string;
  email?: string;
  password?: string;
  fullName?: string;
}

export default function SignUp() {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [loadingSignUp, setLoadingSignUp] = useState(false);
  const [errors, setErrors] = useState<ValidationErrors>({});

  const validateUsername = (value: string): string | undefined => {
    if (!value) return "Username is required";
    if (value.length < 3) return "Username must be at least 3 characters";
    if (value.length > 50) return "Username must be less than 50 characters";
    if (!/^[a-zA-Z0-9_]+$/.test(value))
      return "Username can only contain letters, numbers, and underscores";
    return undefined;
  };

  const validateEmail = (value: string): string | undefined => {
    if (!value) return "Email is required";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))
      return "Please enter a valid email address";
    return undefined;
  };

  const validatePassword = (value: string): string | undefined => {
    if (!value) return "Password is required";
    if (value.length < 8) return "Password must be at least 8 characters";
    return undefined;
  };

  const handleFieldBlur = (field: keyof ValidationErrors, value: string) => {
    let error: string | undefined;
    switch (field) {
      case "username":
        error = validateUsername(value);
        break;
      case "email":
        error = validateEmail(value);
        break;
      case "password":
        error = validatePassword(value);
        break;
    }
    setErrors((prev) => ({ ...prev, [field]: error }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validate all fields
    const validationErrors: ValidationErrors = {
      username: validateUsername(username),
      email: validateEmail(email),
      password: validatePassword(password),
    };

    setErrors(validationErrors);

    // Check if there are any errors
    if (Object.values(validationErrors).some((error) => error !== undefined)) {
      showToast("Please fix the validation errors", "error");
      return;
    }

    setLoadingSignUp(true);
    try {
      const res = await fetch(API_BASE_URL + API_ENDPOINTS.REGISTER, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          username,
          email,
          password,
          fullName: fullName || undefined, // Send only if provided
        }),
      });

      const data = await res.json();
      setLoadingSignUp(false);

      if (res.status === 201 || res.status === 200) {
        showToast("Account created successfully! Please sign in.", "success");
        setTimeout(() => {
          navigate("/login");
        }, 1500);
      } else {
        showToast(data.error || "Sign up failed. Please try again.", "error");
      }
    } catch (error) {
      logger.error("Sign up failed", { data: { error } });
      setLoadingSignUp(false);
      showToast("Network error. Please check your connection.", "error");
    }
  };

  return (
    <div className="flex flex-col h-full p-6">
      <Button
        variant="ghost"
        onClick={() => navigate("/login")}
        className="w-fit gap-2 -ml-2 mb-4"
      >
        <ArrowLeft className="h-4 w-4" />
        <span className="text-sm">Back to Sign In</span>
      </Button>

      <div className="flex-1 flex flex-col justify-center">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-semibold mb-2">Create Account</h1>
          <p className="text-zinc-600 dark:text-zinc-400">
            Join Clipio and sync across devices
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 mb-6">
          <div className="space-y-2">
            <Label htmlFor="username">Username *</Label>
            <div className="relative">
              <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400 dark:text-zinc-500" />
              <Input
                id="username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                onBlur={(e) => handleFieldBlur("username", e.target.value)}
                placeholder="username_123"
                required
                className={cn(
                  "pl-10",
                  errors.username && "border-red-500 focus-visible:ring-red-500"
                )}
              />
            </div>
            {errors.username && (
              <p className="text-xs text-red-600 dark:text-red-400">
                {errors.username}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="fullName">Full Name</Label>
            <div className="relative">
              <UserCircle className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400 dark:text-zinc-500" />
              <Input
                id="fullName"
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="John Doe"
                className="pl-10"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="email">Email *</Label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400 dark:text-zinc-500" />
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onBlur={(e) => handleFieldBlur("email", e.target.value)}
                placeholder="your@email.com"
                required
                className={cn(
                  "pl-10",
                  errors.email && "border-red-500 focus-visible:ring-red-500"
                )}
              />
            </div>
            {errors.email && (
              <p className="text-xs text-red-600 dark:text-red-400">
                {errors.email}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="password">Password *</Label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400 dark:text-zinc-500" />
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onBlur={(e) => handleFieldBlur("password", e.target.value)}
                placeholder="••••••••"
                required
                className={cn(
                  "pl-10",
                  errors.password && "border-red-500 focus-visible:ring-red-500"
                )}
              />
            </div>
            {errors.password && (
              <p className="text-xs text-red-600 dark:text-red-400">
                {errors.password}
              </p>
            )}
          </div>

          <Button type="submit" className="w-full" disabled={loadingSignUp}>
            {loadingSignUp ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Creating Account...
              </>
            ) : (
              "Create Account"
            )}
          </Button>
        </form>
      </div>
    </div>
  );
}
